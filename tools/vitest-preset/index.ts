import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export function vitestPreset(dir: string) {
  return defineConfig({
    root: dir,
    plugins: [swc.vite({ jsc: { target: "es2022" } })],
    test: {
      include: ["test/**/*.test.ts", "src/**/*.test.ts", "*.test.ts"],
      environment: "node",
      testTimeout: 30_000,
    },
  });
}
