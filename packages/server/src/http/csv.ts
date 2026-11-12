export const CSV_MAX_ROWS = 10_000;

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = value instanceof Date ? value.toISOString() : String(value);
  // Neutralise spreadsheet formulas in text cells (numbers keep their sign).
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Serialises rows as CSV (CRLF line endings), capped at 10,000 rows. */
export function toCsv(rows: Record<string, unknown>[], columns: { key: string; header: string }[]): string {
  const lines = [columns.map((c) => cell(c.header)).join(",")];
  for (const row of rows.slice(0, CSV_MAX_ROWS)) {
    lines.push(columns.map((c) => cell(row[c.key])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
