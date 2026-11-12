import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const TEMPLATES = join(import.meta.dirname, "../templates");
const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

const words = (id: string) => id.split("-");
const capitalize = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

function listTemplates(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listTemplates(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

/** The files of a new module, from `templates/**` (each `<path>.tmpl` becomes `modules/<id>/<path>`). Writes nothing. */
export function scaffoldModule(id: string, name: string): { path: string; content: string }[] {
  if (!KEBAB.test(id)) throw new Error(`Module id "${id}" must be kebab-case, e.g. "gift-cards"`);
  if (!name.trim()) throw new Error("Module name must not be empty");

  const values: Record<string, string> = {
    id,
    // Escaped once, so the name is safe inside both TypeScript and JSON string literals.
    name: JSON.stringify(name.trim()).slice(1, -1),
    table: id.replaceAll("-", "_"),
    camel: words(id).map((w, i) => (i === 0 ? w : capitalize(w))).join(""),
    pascal: words(id).map(capitalize).join(""),
  };

  return listTemplates(TEMPLATES).map((file) => ({
    path: `modules/${id}/${relative(TEMPLATES, file).replaceAll("\\", "/").replace(/\.tmpl$/, "")}`,
    content: readFileSync(file, "utf8").replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
      const value = values[key];
      if (value === undefined) throw new Error(`Unknown placeholder ${match} in ${file}`);
      return value;
    }),
  }));
}

/** "gift-cards" -> "Gift cards": the default display name. */
export const defaultName = (id: string): string => capitalize(words(id).join(" "));
