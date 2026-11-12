import { Injectable } from "@nestjs/common";
import { handlerFor, type JobHandler, JobsService } from "./jobs.service";

/** Runs each job immediately in the caller; handler errors propagate. Schedules are accepted but never fire. */
@Injectable()
export class InlineJobs extends JobsService {
  private readonly handlers = new Map<string, JobHandler>();

  register(name: string, handler: JobHandler): void {
    this.handlers.set(name, handler);
  }

  async enqueue(name: string, data: unknown): Promise<void> {
    await handlerFor(this.handlers, name)(data);
  }

  async schedule(): Promise<void> {}

  async runScheduled(name: string): Promise<void> {
    await handlerFor(this.handlers, name)(null);
  }
}
