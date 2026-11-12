import { SetMetadata } from "@nestjs/common";

export const ACCESS_KEY = "platform:access";
export const PERMISSION_KEY = "platform:permission";
export const DEMO_LOCKED_KEY = "platform:demo-locked";

export type AccessKind = "public" | "authenticated" | "permission";

/** No session needed. Non-GET requests must come from the admin origin. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(ACCESS_KEY, "public" satisfies AccessKind);
/** Any signed-in staff user. */
export const Authenticated = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ACCESS_KEY, "authenticated" satisfies AccessKind);
/** Signed-in user holding the permission `key` (`<module>.<resource>.<action>`). */
export const RequirePermission =
  (key: string): MethodDecorator =>
  (target, propertyKey, descriptor) => {
    SetMetadata(ACCESS_KEY, "permission" satisfies AccessKind)(target, propertyKey, descriptor);
    SetMetadata(PERMISSION_KEY, key)(target, propertyKey, descriptor);
  };
/** Rejected with 403 `demo.locked` when the demo profile locks risky settings. Combine with an access decorator. */
export const DemoLocked = (): MethodDecorator => SetMetadata(DEMO_LOCKED_KEY, true);
