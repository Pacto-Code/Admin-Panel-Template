import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { type Observable, tap } from "rxjs";
import type { AppConfig } from "@platform/config";
import { AppError } from "../http/app-error";
import { requestContext } from "../http/request-context";
import { API_PREFIX, CONFIG } from "../tokens";
import { NO_AUDIT_KEY } from "./audit-tokens";

const NON_MUTATING = new Set(["GET", "HEAD", "OPTIONS"]);
const ADMIN_PATH = `/${API_PREFIX}/admin/`;

/** Flags a successful mutating admin request that wrote no audit entry, unless the route is @NoAudit. */
@Injectable()
export class AuditEnforcementInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    const ctx = requestContext.get();
    const exempt = this.reflector.getAllAndOverride<string | undefined>(NO_AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!ctx || exempt || NON_MUTATING.has(req.method) || !req.path.startsWith(ADMIN_PATH)) return next.handle();

    return next.handle().pipe(
      tap(() => {
        if (ctx.auditCount > 0) return;
        const message = `${req.method} ${req.path} changed data but wrote no audit entry; use MutationRunner or @NoAudit(reason)`;
        if (this.config.auditEnforcement === "throw") throw new AppError("server.internal", 500, message);
        (req as { log?: { error(m: string): void } }).log?.error(message);
      }),
    );
  }
}
