import { type CanActivate, type ExecutionContext, Inject, Injectable, Optional } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { AppConfig } from "@platform/config";
import { AppError } from "../http/app-error";
import { requestContext } from "../http/request-context";
import { CONFIG } from "../tokens";
import { CsrfService } from "./csrf";
import { ACCESS_KEY, DEMO_LOCKED_KEY, PERMISSION_KEY, type AccessKind } from "./decorators";
import {
  AUTHENTICATOR,
  PERMISSION_RESOLVER,
  emptyPermissionResolver,
  nullAuthenticator,
  type Authenticator,
  type PermissionResolver,
} from "./tokens";

const NON_MUTATING = new Set(["GET", "HEAD", "OPTIONS"]);

const csrfInvalid = () => new AppError("auth.csrf_invalid", 403, "Request could not be verified");

/** Global deny-by-default guard: every route must declare @Public, @Authenticated or @RequirePermission. */
@Injectable()
export class AccessGuard implements CanActivate {
  private readonly authenticator: Authenticator;
  private readonly resolver: PermissionResolver;

  /** AUTHENTICATOR and PERMISSION_RESOLVER come from the (@Global) auth and access modules when loaded. */
  constructor(
    private readonly reflector: Reflector,
    private readonly csrf: CsrfService,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(AUTHENTICATOR) authenticator?: Authenticator,
    @Optional() @Inject(PERMISSION_RESOLVER) resolver?: PermissionResolver,
  ) {
    this.authenticator = authenticator ?? nullAuthenticator;
    this.resolver = resolver ?? emptyPermissionResolver;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Only HTTP routes carry the access metadata this guard checks; fail closed for anything else.
    if (context.getType() !== "http") return false;
    const targets = [context.getHandler(), context.getClass()];
    const kind = this.reflector.getAllAndOverride<AccessKind | undefined>(ACCESS_KEY, targets);
    const req = context.switchToHttp().getRequest<Request>();
    const mutating = !NON_MUTATING.has(req.method);

    if (!kind) throw new AppError("auth.forbidden", 403, "Forbidden");

    if (kind === "public") {
      if (mutating && req.header("origin") !== new URL(this.config.adminUrl).origin) throw csrfInvalid();
    } else {
      const actor = await this.authenticator.authenticate(req);
      if (!actor) throw new AppError("auth.unauthenticated", 401, "Sign in required");
      const ctx = requestContext.get();
      if (ctx) ctx.actor = actor;
      if (mutating && !this.csrf.verify(actor.sessionId, req.header("x-csrf-token") ?? "")) throw csrfInvalid();
      if (kind === "permission") {
        const key = this.reflector.getAllAndOverride<string>(PERMISSION_KEY, targets);
        const { permissions } = await this.resolver.resolve(actor.userId);
        if (!permissions.includes(key)) throw new AppError("auth.forbidden", 403, "Forbidden");
      }
    }

    if (this.config.demo.lockRiskySettings && this.reflector.getAllAndOverride<boolean>(DEMO_LOCKED_KEY, targets)) {
      throw new AppError("demo.locked", 403, "This action is disabled in the demo");
    }
    return true;
  }
}
