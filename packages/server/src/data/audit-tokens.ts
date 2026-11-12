import { SetMetadata } from "@nestjs/common";
import type { Tx } from "@platform/db";

export interface AuditEntryInput {
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
}

/** Stores one audit entry inside the caller's transaction. The audit module provides the real one. */
export interface AuditRecorder {
  record(tx: Tx, entry: AuditEntryInput): Promise<void>;
}

export const AUDIT_RECORDER = Symbol("AUDIT_RECORDER");

/** Used when no audit module is loaded. */
export const noopAuditRecorder: AuditRecorder = { record: async () => {} };

export const NO_AUDIT_KEY = "platform:no-audit";

/** Exempts a mutating admin route from the audit check. The reason documents why the route needs no entry. */
export const NoAudit = (reason: string): MethodDecorator => {
  if (!reason.trim()) throw new Error("@NoAudit needs a reason");
  return SetMetadata(NO_AUDIT_KEY, reason);
};
