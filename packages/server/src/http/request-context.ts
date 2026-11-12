import { AsyncLocalStorage } from "node:async_hooks";

export interface Actor {
  userId: string;
  email: string;
  sessionId: string;
}

export interface RequestContext {
  requestId: string;
  actor: Actor | null;
  ip: string | null;
  userAgent: string | null;
  auditCount: number;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  get(): RequestContext | undefined {
    return storage.getStore();
  },
  run<T>(ctx: RequestContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },
  /** Runs `fn` with no request context, e.g. background work started from inside a request. */
  exit<T>(fn: () => T): T {
    return storage.exit(fn);
  },
};
