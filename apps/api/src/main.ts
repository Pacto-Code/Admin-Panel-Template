import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { configureApp } from "@platform/server";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  await app.listen(4000);
}

void bootstrap();
