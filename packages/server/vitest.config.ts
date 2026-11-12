import { join } from "node:path";
import { mergeConfig } from "vitest/config";
import { vitestPreset } from "@platform/vitest-preset";

// The contract test scaffolds a module under test/.fixtures that imports "@platform/server" like a real module.
// This package does not depend on itself, so point those imports at its source explicitly.
export default mergeConfig(vitestPreset(import.meta.dirname), {
  resolve: {
    alias: [
      { find: /^@platform\/server$/, replacement: join(import.meta.dirname, "src/index.ts") },
      { find: /^@platform\/server\/testing$/, replacement: join(import.meta.dirname, "src/testing/index.ts") },
    ],
  },
});
