import { AppError } from "./app-error";

export interface ListQuery {
  page: number;
  pageSize: number;
  sort: { field: string; dir: "asc" | "desc" }[];
  filter: Record<string, string>;
  format: "json" | "csv";
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function invalid(field: string, message: string): never {
  throw new AppError("request.invalid_query", 400, "Invalid query", { [field]: [message] });
}

function positiveInt(raw: unknown, field: string, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  if (typeof raw !== "string" || !/^\d+$/.test(raw) || Number(raw) < 1) invalid(field, "Must be a positive integer");
  return Number(raw);
}

/** Parses and validates `page`, `pageSize`, `sort`, `filter[...]` and `format` from a query string. */
export function parseListQuery(
  raw: unknown,
  opts: { sortable: string[]; filterable: string[]; defaultSort: string },
): ListQuery {
  const q = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const page = positiveInt(q.page, "page", 1);
  const pageSize = Math.min(positiveInt(q.pageSize, "pageSize", DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);

  const sortRaw = q.sort === undefined || q.sort === "" ? opts.defaultSort : q.sort;
  if (typeof sortRaw !== "string") invalid("sort", "Must be a comma-separated list");
  const sort = sortRaw.split(",").map((part) => {
    const dir = part.startsWith("-") ? "desc" : "asc";
    const field = part.replace(/^-/, "");
    if (!opts.sortable.includes(field)) invalid("sort", `Cannot sort by "${field}"`);
    return { field, dir } as const;
  });

  const filter: Record<string, string> = {};
  if (q.filter !== undefined) {
    if (typeof q.filter !== "object" || q.filter === null || Array.isArray(q.filter)) {
      invalid("filter", "Must be filter[name]=value");
    }
    for (const [key, value] of Object.entries(q.filter)) {
      if (!opts.filterable.includes(key)) invalid(`filter.${key}`, `Cannot filter by "${key}"`);
      if (typeof value !== "string") invalid(`filter.${key}`, "Must be a single value");
      filter[key] = value;
    }
  }

  const format = q.format ?? "json";
  if (format !== "json" && format !== "csv") invalid("format", 'Must be "json" or "csv"');

  return { page, pageSize, sort: [...sort], filter, format };
}
