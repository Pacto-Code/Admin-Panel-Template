import type { Writable } from "node:stream";
import type { RequestHandler } from "express";
import { pinoHttp } from "pino-http";

const REDACT = [
  "req.headers.cookie",
  "req.headers.authorization",
  'res.headers["set-cookie"]',
  "password",
  "*.password",
  "req.body.password",
];

/** Request logger: one line per request carrying the request id, with secrets redacted. */
export function createHttpLogger(level: string, stream?: Writable): RequestHandler {
  return pinoHttp(
    {
      level,
      redact: { paths: REDACT, censor: "[redacted]" },
      genReqId: (req) => (req as { requestId?: string }).requestId ?? "",
      customProps: (req) => ({ requestId: (req as { requestId?: string }).requestId }),
    },
    stream,
  ) as unknown as RequestHandler;
}
