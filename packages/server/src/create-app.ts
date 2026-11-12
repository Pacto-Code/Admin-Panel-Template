import type { Writable } from "node:stream";
import { Module, type INestApplication, type Provider, type Type } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import type { AppConfig } from "@platform/config";
import type { Db } from "@platform/db";
import { sendError } from "./http/error-filter";
import { createErrorTracker } from "./http/error-tracker";
import { PinoNestLogger, createHttpLogger, createRootLogger } from "./http/logging";
import { requestIdMiddleware } from "./http/request-id.middleware";
import { PlatformModule } from "./platform.module";
import { API_PREFIX, type ErrorTracker } from "./tokens";

export { API_PREFIX };

@Module({})
class RootModule {}

/** Builds the Nest app with every HTTP convention applied. `errorTracker` and `logStream` are test seams. */
export async function createApp(opts: {
  config: AppConfig;
  db: Db;
  modules: Type[];
  /**
   * Extra providers for the platform module (test seams, e.g. a fake AUTHENTICATOR). They take precedence over
   * the same token exported by a @Global module. Real implementations come from modules instead.
   */
  providers?: Provider[];
  errorTracker?: ErrorTracker;
  logStream?: Writable;
  /** "boss" (default) runs jobs on pg-boss; "inline" runs them immediately in the caller (tests). Migrations are the caller's job. */
  jobs?: "boss" | "inline";
}): Promise<INestApplication> {
  const { config } = opts;
  const tracker = opts.errorTracker ?? (await createErrorTracker(config));
  const logger = createRootLogger(config.logLevel, opts.logStream);

  const app = await NestFactory.create<NestExpressApplication>(
    {
      module: RootModule,
      imports: [
        PlatformModule.register({
          config,
          db: opts.db,
          errorTracker: tracker,
          providers: opts.providers,
          jobs: opts.jobs ?? "boss",
        }),
        ...opts.modules,
      ],
    },
    // abortOnError false: a DI or scan error rejects here (and is logged) instead of calling process.exit(1).
    { bodyParser: false, logger: new PinoNestLogger(logger), abortOnError: false },
  );

  app.set("query parser", "extended");
  // Decides req.ip (RequestContext.ip, the throttler key) behind a load balancer; see TRUST_PROXY.
  app.set("trust proxy", config.trustProxy);
  app.setGlobalPrefix(API_PREFIX);
  app.use(helmet());
  const allowedOrigin = new URL(config.adminUrl).origin;
  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) =>
      cb(null, origin === allowedOrigin),
    credentials: true,
    exposedHeaders: ["X-Request-Id"],
  });
  app.use(requestIdMiddleware);
  app.use(createHttpLogger(logger));
  app.use(express.json({ limit: "1mb" }));
  // Body-parser errors happen before routing, so they bypass the Nest exception filters.
  // Express identifies error handlers by their four parameters, so `next` must stay.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => sendError(err, req, res, tracker));
  return app;
}
