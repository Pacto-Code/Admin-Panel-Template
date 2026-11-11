import { Module } from "@nestjs/common";
import { HealthController } from "@platform/server";

@Module({ controllers: [HealthController] })
export class AppModule {}
