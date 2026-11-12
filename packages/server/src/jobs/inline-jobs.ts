import { AsyncLocalStorage } from "node:async_hooks";
import { Injectable } from "@nestjs/common";
import { requestContext } from "../http/request-context";
import { handlerFor, type JobHandler, JobsService } from "./jobs.service";

type Run = () => Promise<void>;

/**
 * Runs jobs in the caller (tests). Handler errors propagate. Schedules are accepted but never fire.
 *
 * Like pg-boss workers, handlers run outside the caller's request context, and a job enqueued inside
 * `deferRuns` (the outbox claim) runs only after that transaction commits. Unlike pg-boss there is no
 * retry: a failing handler's error reaches the caller and its event is not redelivered. That is fine for
 * tests, which see the error (the dispatcher reports it to the error tracker) rather than a silent retry.
 */
@Injectable()
export class InlineJobs extends JobsService {
  private readonly handlers = new Map<string, JobHandler>();
  private readonly deferred = new AsyncLocalStorage<Run[]>();

  register(name: string, handler: JobHandler): void {
    this.handlers.set(name, handler);
  }

  async enqueue(name: string, data: unknown): Promise<void> {
    const handler = handlerFor(this.handlers, name);
    const run = () => requestContext.exit(() => this.deferred.exit(() => handler(data)));
    const batch = this.deferred.getStore();
    if (batch) batch.push(run);
    else await run();
  }

  async schedule(): Promise<void> {}

  async runScheduled(name: string): Promise<void> {
    await handlerFor(this.handlers, name)(null);
  }

  override async deferRuns<T>(fn: () => Promise<T>): Promise<T> {
    const batch: Run[] = [];
    const result = await this.deferred.run(batch, fn);
    const failures: unknown[] = [];
    for (const run of batch) {
      try {
        await run();
      } catch (err) {
        failures.push(err);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, `${failures.length} inline jobs failed`);
    return result;
  }
}
