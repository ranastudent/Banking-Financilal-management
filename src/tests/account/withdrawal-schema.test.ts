import { describe, expect, it } from "vitest";

import { withdrawalSchema } from "../../account/schemas/withdrawal.schema";

describe("Withdrawal Request Schema", () => {
  it("should accept a valid BDT withdrawal", () => {
    const result = withdrawalSchema.safeParse({
      amount: "3000.00",
      currency: "BDT",
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data).toEqual({
        amount: "3000.00",
        currency: "BDT",
      });
    }
  });

  it("should normalize currency to uppercase", () => {
    const result = withdrawalSchema.safeParse({
      amount: "3000.00",
      currency: "usd",
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.currency).toBe("USD");
    }
  });

  it("should trim amount and currency whitespace", () => {
    const result = withdrawalSchema.safeParse({
      amount: " 3000.00 ",
      currency: " bdt ",
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.amount).toBe("3000.00");
      expect(result.data.currency).toBe("BDT");
    }
  });

  it("should accept an amount with up to 8 decimal places", () => {
    const result = withdrawalSchema.safeParse({
      amount: "3000.12345678",
      currency: "BDT",
    });

    expect(result.success).toBe(true);
  });

  it("should reject zero amount", () => {
    const result = withdrawalSchema.safeParse({
      amount: "0",
      currency: "BDT",
    });

    expect(result.success).toBe(false);
  });

  it("should reject zero decimal amount", () => {
    const result = withdrawalSchema.safeParse({
      amount: "0.00",
      currency: "BDT",
    });

    expect(result.success).toBe(false);
  });

  it("should reject negative amount", () => {
    const result = withdrawalSchema.safeParse({
      amount: "-100.00",
      currency: "BDT",
    });

    expect(result.success).toBe(false);
  });

  it("should reject non-numeric amount", () => {
    const result = withdrawalSchema.safeParse({
      amount: "abc",
      currency: "BDT",
    });

    expect(result.success).toBe(false);
  });

  it("should reject amount with more than 8 decimal places", () => {
    const result = withdrawalSchema.safeParse({
      amount: "100.123456789",
      currency: "BDT",
    });

    expect(result.success).toBe(false);
  });

  it("should reject an empty amount", () => {
    const result = withdrawalSchema.safeParse({
      amount: "",
      currency: "BDT",
    });

    expect(result.success).toBe(false);
  });

  it("should reject a currency with fewer than 3 characters", () => {
    const result = withdrawalSchema.safeParse({
      amount: "3000.00",
      currency: "BD",
    });

    expect(result.success).toBe(false);
  });

  it("should reject a currency with more than 3 characters", () => {
    const result = withdrawalSchema.safeParse({
      amount: "3000.00",
      currency: "USDX",
    });

    expect(result.success).toBe(false);
  });

  it("should reject a currency containing non-letter characters", () => {
    const result = withdrawalSchema.safeParse({
      amount: "3000.00",
      currency: "BD1",
    });

    expect(result.success).toBe(false);
  });

  it("should reject a request without amount", () => {
    const result = withdrawalSchema.safeParse({
      currency: "BDT",
    });

    expect(result.success).toBe(false);
  });

  it("should reject a request without currency", () => {
    const result = withdrawalSchema.safeParse({
      amount: "3000.00",
    });

    expect(result.success).toBe(false);
  });

  it("should reject client-provided balance", () => {
    const result = withdrawalSchema.safeParse({
      amount: "3000.00",
      currency: "BDT",
      balance: "100000.00",
    });

    expect(result.success).toBe(false);
  });

  it("should reject client-provided accountId", () => {
    const result = withdrawalSchema.safeParse({
      amount: "3000.00",
      currency: "BDT",
      accountId: "some-account-id",
    });

    expect(result.success).toBe(false);
  });

  it("should reject arbitrary extra fields", () => {
    const result = withdrawalSchema.safeParse({
      amount: "3000.00",
      currency: "BDT",
      status: "COMPLETED",
    });

    expect(result.success).toBe(false);
  });
});