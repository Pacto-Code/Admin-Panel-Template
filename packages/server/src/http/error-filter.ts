import { Catch, HttpException, Inject, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { Request, Response } from "express";
import { ConflictError } from "@platform/db";
import { ERROR_TRACKER, type ErrorTracker } from "../tokens";
import { AppError } from "./app-error";
import type { RequestWithId } from "./request-id.middleware";

interface Described {
  status: number;
  code: string;
  message: string;
  fields: Record<string, string[]>;
  unexpected: boolean;
}

const BY_STATUS: Record<number, { code: string; message: string }> = {
  400: { code: "request.validation_failed", message: "Invalid request" },
  401: { code: "auth.unauthenticated", message: "Authentication required" },
  403: { code: "auth.forbidden", message: "You do not have permission to do this" },
  404: { code: "request.not_found", message: "Not found" },
  409: { code: "request.conflict", message: "The record was modified by someone else" },
  413: { code: "request.too_large", message: "Request body too large" },
  429: { code: "request.rate_limited", message: "Too many requests" },
};

const INTERNAL: Described = {
  status: 500,
  code: "server.internal",
  message: "Something went wrong",
  fields: {},
  unexpected: true,
};

function fromStatus(status: number): Described {
  const known = BY_STATUS[status];
  if (known) return { status, ...known, fields: {}, unexpected: false };
  if (status >= 400 && status < 500) {
    return { status, code: "request.error", message: "Invalid request", fields: {}, unexpected: false };
  }
  return INTERNAL;
}

function describe(error: unknown): Described {
  if (error instanceof AppError) {
    return { status: error.status, code: error.code, message: error.message, fields: error.fields, unexpected: false };
  }
  if (error instanceof ConflictError) return fromStatus(409);
  if (error instanceof HttpException) return fromStatus(error.getStatus());
  // Errors from Express middleware (body-parser) carry a numeric status and a string type.
  const e = error as { status?: unknown; type?: unknown } | null;
  if (e && typeof e.status === "number" && typeof e.type === "string") return fromStatus(e.status);
  return INTERNAL;
}

/** Writes the standard error body; unexpected errors are logged and sent to the tracker. */
export function sendError(error: unknown, req: Request, res: Response, tracker: ErrorTracker): void {
  const d = describe(error);
  const requestId = (req as RequestWithId).requestId;
  if (d.unexpected) {
    (req as { log?: { error(o: object, m: string): void } }).log?.error({ err: error }, "Unhandled error");
    tracker.capture(error, { requestId });
  }
  res.status(d.status).json({ error: { code: d.code, message: d.message, fields: d.fields, requestId } });
}

@Catch()
export class ErrorFilter implements ExceptionFilter {
  constructor(@Inject(ERROR_TRACKER) private readonly tracker: ErrorTracker) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    sendError(exception, ctx.getRequest<Request>(), ctx.getResponse<Response>(), this.tracker);
  }
}
