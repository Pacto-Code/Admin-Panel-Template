import { expect, it } from "vitest";
import { toCsv } from "../../src";

const cols = [{ key: "name", header: "Name" }];
it("quotes commas, quotes and newlines", () =>
  expect(toCsv([{ name: 'a,"b"\nc' }], cols)).toBe('Name\r\n"a,""b""\nc"\r\n'));
it.each(["=SUM(A1)", "+1", "-1", "@cmd"])("neutralises a formula cell %s", (v) =>
  expect(toCsv([{ name: v }], cols)).toBe(`Name\r\n'${v}\r\n`));
it("writes empty string for null and undefined", () =>
  expect(toCsv([{ name: null }], cols)).toBe("Name\r\n\r\n"));
