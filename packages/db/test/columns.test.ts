import { describe, expect, it } from "vitest";
import { uuidv7 } from "../src";

describe("id generation", () => {
  it("generates time-ordered ids", () => {
    const a = uuidv7();
    const b = uuidv7();
    expect(a < b).toBe(true);
  });
});
