import "reflect-metadata";
import { SetMetadata } from "@nestjs/common";

export const ACCESS_KEY = "platform:access";
export const PERMISSION_KEY = "platform:permission";
export const DEMO_LOCKED_KEY = "platform:demo-locked";

export type AccessKind = "public" | "authenticated" | "permission";

const ACCESS_LABEL_KEY = "platform:access-label";

/** Sets the access kind on a method or class. Two access decorators on one method would silently drop one, so throw. */
function access(kind: AccessKind, label: string, key?: string): MethodDecorator & ClassDecorator {
  return ((target: object, propertyKey?: string | symbol, descriptor?: PropertyDescriptor) => {
    const holder = descriptor?.value ?? target;
    if (descriptor) {
      const previous = Reflect.getOwnMetadata(ACCESS_LABEL_KEY, holder) as string | undefined;
      if (previous !== undefined) {
        const name = `${(target as { constructor: { name: string } }).constructor.name}.${String(propertyKey)}`;
        throw new Error(`Route ${name} has conflicting access decorators: @${previous} and @${label}`);
      }
      Reflect.defineMetadata(ACCESS_LABEL_KEY, label, holder);
    }
    Reflect.defineMetadata(ACCESS_KEY, kind, holder);
    if (key !== undefined) Reflect.defineMetadata(PERMISSION_KEY, key, holder);
  }) as MethodDecorator & ClassDecorator;
}

/** No session needed. Non-GET requests must come from the admin origin. */
export const Public = (): MethodDecorator & ClassDecorator => access("public", "Public");
/** Any signed-in staff user. */
export const Authenticated = (): MethodDecorator & ClassDecorator => access("authenticated", "Authenticated");
/** Signed-in user holding the permission `key` (`<module>.<resource>.<action>`). */
export const RequirePermission = (key: string): MethodDecorator =>
  access("permission", "RequirePermission", key) as MethodDecorator;
/** Rejected with 403 `demo.locked` when the demo profile locks risky settings. Combine with an access decorator. */
export const DemoLocked = (): MethodDecorator => SetMetadata(DEMO_LOCKED_KEY, true);
