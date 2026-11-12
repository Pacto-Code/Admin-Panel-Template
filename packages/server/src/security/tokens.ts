import type { Request } from "express";
import type { Actor } from "../http/request-context";

export interface Authenticator {
  /** Resolves the signed-in actor for a request, or null when there is no valid session. */
  authenticate(req: Request): Promise<Actor | null>;
}
export const AUTHENTICATOR = Symbol("AUTHENTICATOR");

export interface PermissionResolver {
  resolve(userId: string): Promise<{ permissions: string[]; roleKeys: string[] }>;
  usersWithPermission(key: string): Promise<string[]>;
}
export const PERMISSION_RESOLVER = Symbol("PERMISSION_RESOLVER");

/** Used until a module (auth) provides a real authenticator: nobody is signed in. */
export const nullAuthenticator: Authenticator = { authenticate: async () => null };
/** Used until a module (auth) provides a real resolver: nobody holds any permission. */
export const emptyPermissionResolver: PermissionResolver = {
  resolve: async () => ({ permissions: [], roleKeys: [] }),
  usersWithPermission: async () => [],
};
