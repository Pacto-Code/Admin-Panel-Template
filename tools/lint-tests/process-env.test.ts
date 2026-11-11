import { ESLint } from "eslint";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const eslint = new ESLint({ cwd: resolve(import.meta.dirname, "../..") });

it("flags process.env outside packages/config", async () => {
  const [r] = await eslint.lintText("export const x = process.env.FOO;", {
    filePath: "modules/auth/api/x.ts",
  });
  expect(r.messages.map((m) => m.message).join()).toContain("@platform/config");
});

it("allows process.env inside packages/config", async () => {
  const [r] = await eslint.lintText("export const x = process.env.FOO;", {
    filePath: "packages/config/src/from-process.ts",
  });
  expect(r.errorCount).toBe(0);
});
