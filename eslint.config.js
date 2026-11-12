import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/.turbo/**", "**/.next/**", "**/.data/**", "packages/server/test/.fixtures/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message: "Read configuration through @platform/config",
        },
      ],
    },
  },
  {
    // Test tooling reads TEST_DATABASE_URL directly; it is never production configuration.
    files: ["packages/config/**", "packages/db/src/testing.ts", "tools/vitest-preset/**"],
    rules: { "no-restricted-properties": "off" },
  },
);
