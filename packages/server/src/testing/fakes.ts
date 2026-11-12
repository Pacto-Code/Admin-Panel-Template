import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { Request } from "express";
import type { Tx } from "@platform/db";
import type { AuditEntryInput, AuditRecorder } from "../data/audit-tokens";
import type { Actor } from "../http/request-context";
import type { MailMessage, Mailer } from "../services/tokens";
import type { Authenticator, PermissionResolver } from "../security/tokens";

export interface TestActor {
  userId?: string;
  email?: string;
  permissions: string[];
  roleKeys?: string[];
}

/** The request header FakeAccess reads the acting user from (JSON of a TestActor). */
export const TEST_ACTOR_HEADER = "x-test-actor";

/** A stable UUID-shaped id per distinct actor, so actors with different permissions never share a user id. */
function actorId(actor: TestActor): string {
  const h = createHash("sha256")
    .update(JSON.stringify([actor.email ?? null, actor.permissions, actor.roleKeys ?? []]))
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-7${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Authenticator and permission resolver in one: the session is whatever actor the request names in TEST_ACTOR_HEADER. */
@Injectable()
export class FakeAccess implements Authenticator, PermissionResolver {
  private readonly grants = new Map<string, { permissions: string[]; roleKeys: string[] }>();

  /** The identity (and session id, for CSRF tokens) FakeAccess gives an actor. */
  static identify(actor: TestActor): Actor {
    const userId = actor.userId ?? actorId(actor);
    return { userId, email: actor.email ?? `${userId}@example.com`, sessionId: `s-${userId}` };
  }

  async authenticate(req: Request): Promise<Actor | null> {
    const raw = req.header(TEST_ACTOR_HEADER);
    if (!raw) return null;
    const actor = JSON.parse(raw) as TestActor;
    const identity = FakeAccess.identify(actor);
    this.grants.set(identity.userId, { permissions: actor.permissions, roleKeys: actor.roleKeys ?? [] });
    return identity;
  }

  async resolve(userId: string) {
    return this.grants.get(userId) ?? { permissions: [], roleKeys: [] };
  }

  async usersWithPermission(key: string) {
    return [...this.grants].filter(([, g]) => g.permissions.includes(key)).map(([id]) => id);
  }
}

/** Keeps audit entries in memory instead of a table. */
export class FakeRecorder implements AuditRecorder {
  entries: AuditEntryInput[] = [];
  async record(_tx: Tx, entry: AuditEntryInput) {
    this.entries.push(entry);
  }
}

/** Keeps mail in memory; enqueued mail counts as sent. */
export class FakeMailer implements Mailer {
  sent: MailMessage[] = [];
  async send(msg: MailMessage) {
    this.sent.push(msg);
  }
  async enqueue(msg: MailMessage) {
    this.sent.push(msg);
  }
}
