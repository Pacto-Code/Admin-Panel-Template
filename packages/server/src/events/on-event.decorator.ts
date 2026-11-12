import "reflect-metadata";

export const ON_EVENT_KEY = "platform:on-event";

/**
 * Marks a provider method as a handler for a domain event: `handler(payload, { eventId })`.
 * Delivery is at-least-once, so handlers must be idempotent (use `eventId` to deduplicate).
 */
export const OnEvent =
  (name: string): MethodDecorator =>
  (_target, _key, descriptor) => {
    const names = (Reflect.getMetadata(ON_EVENT_KEY, descriptor.value as object) as string[] | undefined) ?? [];
    Reflect.defineMetadata(ON_EVENT_KEY, [...names, name], descriptor.value as object);
  };
