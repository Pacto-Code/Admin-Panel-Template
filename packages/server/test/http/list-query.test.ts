import { expect, it } from "vitest";
import { AppError, parseListQuery } from "../../src";

const opts = { sortable: ["name", "createdAt"], filterable: ["status"], defaultSort: "-createdAt" };
it("defaults paging and sort", () =>
  expect(parseListQuery({}, opts)).toEqual({
    page: 1,
    pageSize: 25,
    sort: [{ field: "createdAt", dir: "desc" }],
    filter: {},
    format: "json",
  }));
it("caps pageSize at 100", () => expect(parseListQuery({ pageSize: "500" }, opts).pageSize).toBe(100));
it("parses multi-field sort, filters and csv format", () =>
  expect(parseListQuery({ sort: "name,-createdAt", filter: { status: "active" }, format: "csv" }, opts)).toMatchObject({
    sort: [
      { field: "name", dir: "asc" },
      { field: "createdAt", dir: "desc" },
    ],
    filter: { status: "active" },
    format: "csv",
  }));
it("rejects an unknown sort field", () => expect(() => parseListQuery({ sort: "password" }, opts)).toThrow(AppError));
it("rejects an unknown filter", () => expect(() => parseListQuery({ filter: { secret: "1" } }, opts)).toThrow(AppError));
it("rejects page 0 and non-numbers", () => {
  expect(() => parseListQuery({ page: "0" }, opts)).toThrow(AppError);
  expect(() => parseListQuery({ page: "abc" }, opts)).toThrow(AppError);
});
