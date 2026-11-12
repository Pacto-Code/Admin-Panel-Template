import "reflect-metadata";
import { loadConfigFromProcess } from "@platform/config";
import { createDb } from "@platform/db";
import { createApp } from "@platform/server";
import store from "../../../store.config";
import { AppModule } from "./app.module";

async function bootstrap() {
  const config = loadConfigFromProcess(store);
  const { db } = createDb(config.databaseUrl);
  const app = await createApp({ config, db, modules: [AppModule] });
  await app.listen(config.port);
}

void bootstrap();
