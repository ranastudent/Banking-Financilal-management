import { describe, expect, it } from "vitest";
import { isPlainObject } from "../../monitoring/types/monitoring.types";

describe("monitoring event input primitives", () => {
  it("accepts object payloads", () => {
    expect(isPlainObject({ transactionId: "tx-1" })).toBe(true);
  });
  it("rejects arrays, null and primitives", () => {
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject("payload")).toBe(false);
  });
});
