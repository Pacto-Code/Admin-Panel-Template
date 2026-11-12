import type { ModuleManifest, NavItem } from "./manifest";

export class ModuleRegistry {
  private readonly byId = new Map<string, ModuleManifest>();

  constructor(private readonly manifests: ModuleManifest[]) {
    for (const m of manifests) this.byId.set(m.id, m);
  }

  all(): ModuleManifest[] { return [...this.manifests]; }
  get(id: string): ModuleManifest | undefined { return this.byId.get(id); }
  has(id: string): boolean { return this.byId.has(id); }

  permissionKeys(): string[] {
    return this.manifests.flatMap((m) => m.permissions.map((p) => p.key));
  }

  nav(): (NavItem & { moduleId: string })[] {
    return this.manifests
      .flatMap((m) => (m.nav ?? []).map((n) => ({ ...n, moduleId: m.id })))
      .sort((x, y) => x.order - y.order);
  }
}
