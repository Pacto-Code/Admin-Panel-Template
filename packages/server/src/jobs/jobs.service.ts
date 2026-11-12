export type JobHandler = (data: unknown) => Promise<void>;

/**
 * Background jobs. `createApp` picks pg-boss (default) or the inline runner (tests).
 * Register handlers in `onModuleInit`; the pg-boss workers start at application bootstrap.
 */
export abstract class JobsService {
  abstract register(name: string, handler: JobHandler): void;
  abstract enqueue(name: string, data: unknown): Promise<void>;
  abstract schedule(name: string, cron: string): Promise<void>;
  /** Runs a registered handler now, in this process. For tests and the CLI. */
  abstract runScheduled(name: string): Promise<void>;
}

export function handlerFor(handlers: Map<string, JobHandler>, name: string): JobHandler {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`No handler registered for job "${name}"`);
  return handler;
}
