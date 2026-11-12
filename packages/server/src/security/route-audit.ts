import { RequestMethod, type INestApplication, type Type } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { DiscoveryService } from "@nestjs/core";
import { API_PREFIX } from "../create-app";
import { ACCESS_KEY } from "./decorators";

const paths = (value: unknown): string[] => (Array.isArray(value) ? value : [value ?? ""]).map(String);
const join = (...parts: string[]) => "/" + parts.map((p) => p.replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/");

export interface ControllerRoute {
  /** "GET", "POST", ... */
  method: string;
  /** Full path, e.g. "/api/v1/admin/items/:id". */
  path: string;
  handler: object;
}

/** The routes a controller class declares, read from its decorators. */
export function controllerRoutes(type: Type): ControllerRoute[] {
  const routes: ControllerRoute[] = [];
  for (const name of Object.getOwnPropertyNames(type.prototype)) {
    const handler = Object.getOwnPropertyDescriptor(type.prototype, name)?.value as unknown;
    if (typeof handler !== "function") continue;
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
    if (method === undefined) continue;
    for (const base of paths(Reflect.getMetadata(PATH_METADATA, type)))
      for (const sub of paths(Reflect.getMetadata(PATH_METADATA, handler)))
        routes.push({ method: RequestMethod[method], path: join(API_PREFIX, base, sub), handler });
  }
  return routes;
}

/** Lists routes with no access decorator, as "METHOD /api/v1/path". Used by CI to keep the guard honest. */
export function findUnguardedRoutes(app: INestApplication): string[] {
  const found: string[] = [];
  for (const wrapper of app.get(DiscoveryService).getControllers()) {
    const type = wrapper.metatype as Type | null;
    if (!type || Reflect.getMetadata(ACCESS_KEY, type) !== undefined) continue;
    for (const route of controllerRoutes(type)) {
      if (Reflect.getMetadata(ACCESS_KEY, route.handler) === undefined) found.push(`${route.method} ${route.path}`);
    }
  }
  return found.sort();
}
