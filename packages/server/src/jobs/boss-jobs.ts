import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { PgBoss } from "pg-boss";
import type { AppConfig } from "@platform/config";
import { CONFIG, ERROR_TRACKER, type ErrorTracker } from "../tokens";
import { handlerFor, type JobHandler, JobsService } from "./jobs.service";

/** pg-boss on the application database. Starts at bootstrap, stops on app close. */
@Injectable()
export class BossJobs extends JobsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("Jobs");
  private readonly handlers = new Map<string, JobHandler>();
  private readonly schedules = new Map<string, string>();
  private readonly queues = new Set<string>();
  private boss: PgBoss | null = null;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(ERROR_TRACKER) private readonly tracker: ErrorTracker,
  ) {
    super();
  }

  register(name: string, handler: JobHandler): void {
    if (this.boss) throw new Error(`Job "${name}" registered after start; register handlers in onModuleInit`);
    this.handlers.set(name, handler);
  }

  async enqueue(name: string, data: unknown): Promise<void> {
    const boss = this.started();
    await this.ensureQueue(boss, name);
    await boss.send(name, data as object);
  }

  async schedule(name: string, cron: string): Promise<void> {
    this.schedules.set(name, cron);
    if (this.boss) await this.applySchedule(this.boss, name, cron);
  }

  async runScheduled(name: string): Promise<void> {
    await handlerFor(this.handlers, name)(null);
  }

  async onApplicationBootstrap(): Promise<void> {
    const boss = new PgBoss(this.config.databaseUrl);
    boss.on("error", (err) => {
      this.logger.error(err);
      this.tracker.capture(err, {});
    });
    await boss.start();
    // Set before the workers start, so shutdown still stops pg-boss if a later step fails.
    this.boss = boss;
    for (const [name, handler] of this.handlers) {
      await this.ensureQueue(boss, name);
      await boss.work(name, async (jobs) => {
        for (const job of jobs) await handler(job.data);
      });
    }
    for (const [name, cron] of this.schedules) await this.applySchedule(boss, name, cron);
  }

  async onApplicationShutdown(): Promise<void> {
    const boss = this.boss;
    this.boss = null;
    await boss?.stop({ graceful: true, timeout: 10_000 });
  }

  private started(): PgBoss {
    if (!this.boss) throw new Error("Jobs are not running; enqueue after application bootstrap");
    return this.boss;
  }

  private async ensureQueue(boss: PgBoss, name: string): Promise<void> {
    if (this.queues.has(name)) return;
    await boss.createQueue(name);
    this.queues.add(name);
  }

  private async applySchedule(boss: PgBoss, name: string, cron: string): Promise<void> {
    await this.ensureQueue(boss, name);
    await boss.schedule(name, cron);
  }
}
