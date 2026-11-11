import { describe, expect, it } from "vitest";
import { matchPage, type AdminPage } from "../src/index";

const load: AdminPage["load"] = async () => ({ default: () => null });
const page: AdminPage = { path: "/", access: "authenticated", layout: "app", load };

describe("matchPage", () => {
  it("matches a parameterised path", () =>
    expect(matchPage([{ path: "/roles/:id", access: "access.role.read", layout: "app", load }], "/roles/42")?.params).toEqual({ id: "42" }));
  it("prefers a static path over a parameter", () =>
    expect(matchPage([{ ...page, path: "/roles/:id" }, { ...page, path: "/roles/new" }], "/roles/new")?.page.path).toBe("/roles/new"));
  it("returns null for an unknown path", () => expect(matchPage([], "/nope")).toBeNull());
});
