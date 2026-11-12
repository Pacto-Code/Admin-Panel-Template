import type { ComponentType } from "react";

export type PageAccess = string | "authenticated" | "public"; // string = permission key
export interface AdminPage {
  path: string; access: PageAccess; layout: "app" | "auth";
  load: () => Promise<{ default: ComponentType<{ params: Record<string, string> }> }>;
}
export interface AdminWidget {
  id: string; title: string; permission: string; size: "sm" | "md" | "lg";
  load: () => Promise<{ default: ComponentType }>;
}
export interface SearchHit { title: string; subtitle?: string; href: string }
export interface SearchSource { id: string; permission: string; search(q: string): Promise<SearchHit[]> }
export interface PaletteCommand { id: string; label: string; permission: string; href: string }
export interface AdminModuleDef {
  id: string; pages: AdminPage[]; widgets?: AdminWidget[];
  search?: SearchSource[]; commands?: PaletteCommand[];
  topBar?: { id: string; load: () => Promise<{ default: ComponentType }> }[];
  messages: Record<string, () => Promise<{ default: Record<string, unknown> }>>;
}

const segments = (p: string) => p.split("/").filter(Boolean);

/** Matches pathname against pages; static segments beat `:param` segments. */
export function matchPage(
  pages: AdminPage[],
  pathname: string,
): { page: AdminPage; params: Record<string, string> } | null {
  const target = segments(pathname);
  let best: { page: AdminPage; params: Record<string, string>; statics: number } | null = null;
  for (const page of pages) {
    const parts = segments(page.path);
    if (parts.length !== target.length) continue;
    const params: Record<string, string> = {};
    let statics = 0;
    const ok = parts.every((part, i) => {
      const seg = target[i]!;
      if (part.startsWith(":")) {
        params[part.slice(1)] = decodeURIComponent(seg);
        return true;
      }
      if (part === seg) { statics++; return true; }
      return false;
    });
    if (ok && (!best || statics > best.statics)) best = { page, params, statics };
  }
  return best && { page: best.page, params: best.params };
}
