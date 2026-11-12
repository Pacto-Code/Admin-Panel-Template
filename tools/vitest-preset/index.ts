import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

/** Reads KEY=value pairs from the repo-root `.env.test.local`, if it exists. */
function loadTestEnv(): Record<string, string> {
  const file = resolve(import.meta.dirname, "../../.env.test.local");
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]!] = m[2]!.replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

export function vitestPreset(dir: string) {
  const fromEnv = process.env.TEST_DATABASE_URL;
  return defineConfig({
    root: dir,
    plugins: [swc.vite({ jsc: { target: "es2022" } })],
    test: {
      include: ["test/**/*.test.ts", "src/**/*.test.ts", "*.test.ts"],
      environment: "node",
      // A value already in the environment wins over the file.
      env: { ...loadTestEnv(), ...(fromEnv ? { TEST_DATABASE_URL: fromEnv } : {}) },
      testTimeout: 30_000,
    },
  });
}
