import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { transform } from "@swc/core";
import { defineConfig, type Options } from "tsup";
type Plugin = NonNullable<Options["esbuildPlugins"]>[number];

// esbuild cannot emit decorator metadata, so TypeScript files go through SWC first.
const swcPlugin: Plugin = {
  name: "swc",
  setup(build) {
    build.onLoad({ filter: /\.ts$/ }, async (args) => {
      const source = await readFile(args.path, "utf8");
      const { code } = await transform(source, {
        filename: args.path,
        sourceMaps: "inline",
        jsc: {
          target: "es2022",
          parser: { syntax: "typescript", decorators: true },
          transform: { legacyDecorator: true, decoratorMetadata: true },
        },
      });
      return { contents: code, loader: "js", resolveDir: dirname(args.path) };
    });
  },
};

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["cjs"],
  target: "node22",
  platform: "node",
  clean: true,
  sourcemap: true,
  // Workspace packages ship TypeScript source, so they are bundled (and decorator metadata emitted) here.
  noExternal: [/^@platform\//, /^@modules\//],
  esbuildPlugins: [swcPlugin],
});
