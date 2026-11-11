import { ModuleConfigError, type ModuleManifest } from "./manifest";

/** Validates the enabled set and returns manifests with dependencies first. */
export function resolveModules(
  enabled: Record<string, unknown>,
  available: Record<string, ModuleManifest>,
): ModuleManifest[] {
  const issues: string[] = [];
  const ids = Object.keys(enabled);

  for (const id of ids) if (!available[id]) issues.push(`Unknown module "${id}"`);
  const known = ids.filter((id) => available[id]);

  for (const m of Object.values(available)) {
    if (m.core && !(m.id in enabled)) issues.push(`Core module "${m.id}" must be enabled`);
  }

  for (const id of known) {
    const m = available[id]!;
    for (const dep of m.dependsOn ?? []) {
      if (!(dep in enabled)) issues.push(`Module "${id}" requires "${dep}", which is not enabled`);
    }
    if (m.options) {
      const result = m.options.safeParse(enabled[id] ?? {});
      if (!result.success) {
        for (const issue of result.error.issues) {
          issues.push(`Module "${id}" option "${issue.path.join(".")}": ${issue.message}`);
        }
      }
    }
  }

  const ordered: ModuleManifest[] = [];
  const state = new Map<string, "visiting" | "done">();
  let cyclic = false;
  const visit = (id: string): void => {
    const m = available[id];
    if (!m || !(id in enabled) || state.get(id) === "done") return;
    if (state.get(id) === "visiting") {
      if (!cyclic) issues.push(`Dependency cycle involving "${id}"`);
      cyclic = true;
      return;
    }
    state.set(id, "visiting");
    for (const dep of m.dependsOn ?? []) visit(dep);
    state.set(id, "done");
    ordered.push(m);
  };
  for (const id of known) visit(id);

  if (issues.length > 0) throw new ModuleConfigError(issues);
  return ordered;
}
