import type { ZodObject } from "zod";

export interface PermissionDef { key: string; label: string }
export interface NavItem {
  label: string; path: string; icon: string; permission: string; order: number;
  /** Shown only when PublicConfig.features includes it. */
  feature?: string;
}
export interface SwitchDef { key: string; label: string; default: boolean }
export interface ModuleManifest {
  id: string; name: string; core?: boolean; dependsOn?: string[];
  permissions: PermissionDef[]; nav?: NavItem[];
  options?: ZodObject; settings?: ZodObject; switches?: SwitchDef[];
  events?: { emits: string[]; handles: string[] };
}

export class ModuleConfigError extends Error {
  constructor(public issues: string[]) {
    super(issues.join("\n"));
    this.name = "ModuleConfigError";
  }
}

const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
/** What follows "<id>." in a permission key: exactly "<resource>.<action>". */
const PERMISSION_REST = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9_-]*$/;

export function validateManifest(m: ModuleManifest): string[] {
  const issues: string[] = [];
  if (!KEBAB.test(m.id)) issues.push(`Module id "${m.id}" must be kebab-case`);
  const declared = new Set<string>();
  for (const p of m.permissions) {
    if (declared.has(p.key)) issues.push(`Permission "${p.key}" is declared more than once`);
    declared.add(p.key);
    if (!p.key.startsWith(`${m.id}.`)) issues.push(`Permission "${p.key}" must start with "${m.id}."`);
    else if (!PERMISSION_REST.test(p.key.slice(m.id.length + 1))) {
      issues.push(`Permission "${p.key}" must be "${m.id}.<resource>.<action>" in lowercase`);
    }
  }
  for (const n of m.nav ?? []) {
    if (!declared.has(n.permission)) issues.push(`Nav item "${n.path}" uses undeclared permission "${n.permission}"`);
  }
  return issues;
}

export function defineManifest(m: ModuleManifest): ModuleManifest {
  const issues = validateManifest(m);
  if (issues.length > 0) throw new ModuleConfigError(issues);
  return m;
}
