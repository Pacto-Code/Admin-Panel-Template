import type { NextFunction, Request, Response } from "express";
import { uuidv7 } from "@platform/db";
import { requestContext } from "./request-context";

const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

export type RequestWithId = Request & { requestId: string };

/** Honours a well-formed incoming X-Request-Id, else generates one; echoes it and opens the request context. */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header("x-request-id");
  const requestId = incoming && SAFE_ID.test(incoming) ? incoming : uuidv7();
  (req as RequestWithId).requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  requestContext.run(
    {
      requestId,
      actor: null,
      ip: req.ip ?? null,
      userAgent: req.header("user-agent") ?? null,
      auditCount: 0,
    },
    next,
  );
}
