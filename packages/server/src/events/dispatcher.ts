import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { DiscoveryService, MetadataScanner } from "@nestjs/core";
import { JobsService } from "../jobs/jobs.service";
import { ERROR_TRACKER, type ErrorTracker } from "../tokens";
import { EVENTS_JOB, EventBus, type EventJob } from "./event-bus";
import { ON_EVENT_KEY } from "./on-event.decorator";

type EventHandler = (payload: unknown, meta: { eventId: string }) => Promise<void> | void;

const INTERVAL_MS = 5_000;

/** Finds `@OnEvent` handlers, runs the `platform.events` job, and drains the outbox after commits and every 5 s. */
@Injectable()
export class EventDispatcher implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger("Events");
  private readonly handlers = new Map<string, EventHandler[]>();
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> = Promise.resolve();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly bus: EventBus,
    private readonly jobs: JobsService,
    @Inject(ERROR_TRACKER) private readonly tracker: ErrorTracker,
  ) {}

  onModuleInit(): void {
    for (const wrapper of this.discovery.getProviders()) {
      const instance = wrapper.instance as Record<string, unknown> | undefined;
      if (!instance || typeof instance !== "object" || !wrapper.isDependencyTreeStatic()) continue;
      const proto = Object.getPrototypeOf(instance) as object;
      for (const method of this.scanner.getAllMethodNames(proto)) {
        const fn = instance[method] as (...args: unknown[]) => unknown;
        const names = Reflect.getMetadata(ON_EVENT_KEY, fn) as string[] | undefined;
        for (const name of names ?? []) {
          const list = this.handlers.get(name) ?? [];
          list.push(fn.bind(instance) as EventHandler);
          this.handlers.set(name, list);
        }
      }
    }
    this.jobs.register(EVENTS_JOB, (data) => this.deliver(data as EventJob));
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.flush(), INTERVAL_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.inFlight;
  }

  /** Dispatches pending events, logging instead of throwing: the outbox keeps anything not sent. */
  flush(): Promise<void> {
    const run = this.bus.dispatchPending().then(
      () => {},
      (err: unknown) => {
        this.logger.error(err);
        this.tracker.capture(err, {});
      },
    );
    this.inFlight = Promise.all([this.inFlight, run]).then(() => {});
    return run;
  }

  /** Runs every handler for the event; any failure fails the job so it is retried. */
  private async deliver(job: EventJob): Promise<void> {
    const failures: unknown[] = [];
    for (const handler of this.handlers.get(job.name) ?? []) {
      try {
        await handler(job.payload, { eventId: job.eventId });
      } catch (err) {
        failures.push(err);
      }
    }
    if (failures.length) throw new AggregateError(failures, `${failures.length} handler(s) failed for ${job.name}`);
  }
}
