import { describe, expect, it } from "vitest";
import { Authenticated, Public, RequirePermission } from "../../src";

describe("access decorators", () => {
  it("rejects @Public above @RequirePermission", () => {
    expect(() => {
      class Foo {
        @Public()
        @RequirePermission("x.y.z")
        bar() {}
      }
      return Foo;
    }).toThrow("Route Foo.bar has conflicting access decorators: @RequirePermission and @Public");
  });
  it("rejects @RequirePermission above @Public", () => {
    expect(() => {
      class Foo {
        @RequirePermission("x.y.z")
        @Public()
        bar() {}
      }
      return Foo;
    }).toThrow(/Foo\.bar has conflicting access decorators/);
  });
  it("rejects @Authenticated with @RequirePermission", () => {
    expect(() => {
      class Foo {
        @Authenticated()
        @RequirePermission("x.y.z")
        bar() {}
      }
      return Foo;
    }).toThrow(/conflicting access decorators: @RequirePermission and @Authenticated/);
  });
  it("allows a class-level decorator with a method-level override", () => {
    expect(() => {
      @Authenticated()
      class Foo {
        @RequirePermission("x.y.z")
        bar() {}
      }
      return Foo;
    }).not.toThrow();
  });
});
