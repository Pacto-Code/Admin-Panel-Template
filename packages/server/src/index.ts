import type { INestApplication } from "@nestjs/common";

export { HealthController } from "./health.controller";

export const API_PREFIX = "api/v1";

export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX);
}
