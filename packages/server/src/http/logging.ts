import type { Writable } from "node:stream";
import type { LoggerService } from "@nestjs/common";
import type { RequestHandler } from "express";
import { pino, type Logger as PinoLogger } from "pino";
import { pinoHttp } from "pino-http";

const REDACT = [
  "req.headers.cookie",
  "req.headers.authorization",
  'res.headers["set-cookie"]',
  "password",
  "*.password",
  "req.body.password",
];

/** The one pino instance per app: HTTP request lines and Nest's own logs both go through it. */
export function createRootLogger(level: string, stream?: Writable): PinoLogger {
  const opts = { level, redact: { paths: REDACT, censor: "[redacted]" } };
  return stream ? pino(opts, stream) : pino(opts);
}

/** Request logger: one line per request carrying the request id, with secrets redacted. */
export function createHttpLogger(logger: PinoLogger): RequestHandler {
  return pinoHttp({
    logger,
    genReqId: (req) => (req as { requestId?: string }).requestId ?? "",
    customProps: (req) => ({ requestId: (req as { requestId?: string }).requestId }),
  }) as unknown as RequestHandler;
}

type Level = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

/**
 * Nest LoggerService on pino, so `new Logger(ctx).error(...)` (outbox flush, pg-boss errors, bootstrap
 * failures) is written with the HTTP logs instead of being dropped. Nest passes the context as the last
 * string argument, and for `error` a stack string before it.
 */
export class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: PinoLogger) {}

  log(message: unknown, ...params: unknown[]) {
    this.write("info", message, params);
  }
  error(message: unknown, ...params: unknown[]) {
    this.write("error", message, params);
  }
  warn(message: unknown, ...params: unknown[]) {
    this.write("warn", message, params);
  }
  debug(message: unknown, ...params: unknown[]) {
    this.write("debug", message, params);
  }
  verbose(message: unknown, ...params: unknown[]) {
    this.write("trace", message, params);
  }
  fatal(message: unknown, ...params: unknown[]) {
    this.write("fatal", message, params);
  }

  private write(level: Level, message: unknown, params: unknown[]) {
    if (!this.logger.isLevelEnabled(level)) return;
    const rest = [...params];
    const context = rest.length > 0 && typeof rest[rest.length - 1] === "string" ? (rest.pop() as string) : undefined;
    const stack = level === "error" && typeof rest[0] === "string" ? (rest.shift() as string) : undefined;
    const bindings: Record<string, unknown> = {};
    if (context) bindings.context = context;
    if (message instanceof Error) {
      this.logger[level]({ ...bindings, err: message }, message.message);
      return;
    }
    if (stack) bindings.stack = stack;
    if (rest.length > 0) bindings.params = rest;
    if (typeof message === "string") this.logger[level](bindings, message);
    else this.logger[level]({ ...bindings, data: message });
  }
}
