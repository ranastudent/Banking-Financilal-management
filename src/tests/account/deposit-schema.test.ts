import { describe, expect, it } from "vitest";

import { depositSchema } from "../../account/schemas/deposit.schema";

describe("Deposit Request Schema", () => {
  it("should accept a valid BDT deposit", () => {
    const result = depositSchema.safeParse({
      amount: "5000.00",
      currency: "BDT",
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data).toEqual({
        amount: "5000.00",
        currency: "BDT",
      });
    }
  });

  it("should normalize currency to uppercase", () => {
    const result = depositSchema.safeParse({
      amount: "5000.00",
      currency: "usd",
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.currency).toBe("USD");
    }
  });

  it("should trim amount and currency whitespace", () => {
    const result = depositSchema.safeParse({
      amount: " 5000.00 ",
      currency: " bdt ",
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.amount).toBe("5000.00");
      expect(result.data.currency).toBe("BDT");
    }
  });

  it("should accept an amount with up to 8 decimal places", () => {
    const result = depositSchema.safeParse({
      amount: "5000.12345678",
      currency: "BDT",
    });

    expect(result.success).toBe(true);
  });

  it("should reject zero amount", () => {
    const result = depositSchema.safeParse({
      amount: "0",
      currency: "BDT",
    });

    expect(result.success).toBe(false);
  });

  it("should reject zero decimal amount", () => {
    const result = depositSchema.safeParse({
      amount: "0.00",
      currency: "BDT",
    });

    expect(result.success).toBe(false);
  });

  it("should reject negative amount", () => {
    const result = depositSchema.safeParse({
      amount: "-100.00",
      currency: "BDT",
    });

    expect(result.success).toBe(false);
  });

  it("should reject non-numeric amount", () => {
    const result = depositSchema.safeParse({
      amount: "abc",
      currency: "BDT",
    });

    expect(result.success).toBe(false);
  });

  it("should reject amount with more than 8 decimal places", () => {
    const result = depositSchema.safeParse({
      amount: "100.123456789",
      currency: "BDT",
    });

    expect(result.success).toBe(false);
  });

  it("should reject an empty amount", () => {
    const result = depositSchema.safeParse({
      amount: "",
      currency: "BDT",
    });

    expect(result.success).toBe(false);
  });

  it("should reject a currency with fewer than 3 characters", () => {
    const result = depositSchema.safeParse({
      amount: "5000.00",
      currency: "BD",
    });

    expect(result.success).toBe(false);
  });

  it("should reject a currency with more than 3 characters", () => {
    const result = depositSchema.safeParse({
      amount: "5000.00",
      currency: "USDX",
    });

    expect(result.success).toBe(false);
  });

  it("should reject a currency containing non-letter characters", () => {
    const result = depositSchema.safeParse({
      amount: "5000.00",
      currency: "BD1",
    });

    expect(result.success).toBe(false);
  });

  it("should reject a request without amount", () => {
    const result = depositSchema.safeParse({
      currency: "BDT",
    });

    expect(result.success).toBe(false);
  });

  it("should reject a request without currency", () => {
    const result = depositSchema.safeParse({
      amount: "5000.00",
    });

    expect(result.success).toBe(false);
  });

  it("should reject client-provided balance", () => {
    const result = depositSchema.safeParse({
      amount: "5000.00",
      currency: "BDT",
      balance: "100000.00",
    });

    expect(result.success).toBe(false);
  });

  it("should reject client-provided accountId", () => {
    const result = depositSchema.safeParse({
      amount: "5000.00",
      currency: "BDT",
      accountId: "some-account-id",
    });

    expect(result.success).toBe(false);
  });

  it("should reject arbitrary extra fields", () => {
    const result = depositSchema.safeParse({
      amount: "5000.00",
      currency: "BDT",
      status: "COMPLETED",
    });

    expect(result.success).toBe(false);
  });
});