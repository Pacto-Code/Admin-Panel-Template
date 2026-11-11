import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/.turbo/**", "**/.next/**", "**/.data/**"] },
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
    files: ["packages/config/**"],
    rules: { "no-restricted-properties": "off" },
  },
);
