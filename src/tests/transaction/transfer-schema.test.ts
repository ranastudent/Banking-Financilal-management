import { describe, expect, it } from "vitest";

import { transferSchema } from "../../transaction/schemas/transfer.schema";

describe("Transfer Request Schema", () => {
  it("should accept a valid BDT transfer", () => {
    const result = transferSchema.safeParse({
      receiverAccount: "ACC-2002",
      amount: "5000.00",
      currency: "BDT",
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data).toEqual({
        receiverAccount: "ACC-2002",
        amount: "5000.00",
        currency: "BDT",
      });
    }
  });

  it("should normalize currency to uppercase", () => {
    const result = transferSchema.safeParse({
      receiverAccount: "ACC-2002",
      amount: "5000.00",
      currency: "usd",
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.currency).toBe("USD");
    }
  });

  it("should trim receiver account, amount, and currency whitespace", () => {
    const result = transferSchema.safeParse({
      receiverAccount: " ACC-2002 ",
      amount: " 5000.00 ",
      currency: " bdt ",
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.receiverAccount).toBe("ACC-2002");
      expect(result.data.amount).toBe("5000.00");
      expect(result.data.currency).toBe("BDT");
    }
  });

  it("should accept an amount with up to 8 decimal places", () => {
    const result = transferSchema.safeParse({
      receiverAccount: "ACC-2002",
      amount: "5000.12345678",
      currency: "BDT",
    });

    expect(result.success).toBe(true);
  });

  it("should reject zero amount", () => {
    const result = transferSchema.safeParse({
      receiverAccount: "ACC-2002",
      amount: "0",
      currency: "BDT",
    });

    expect(result.success).toBe(false);
  });

  it("should reject zero decimal amount", () => {
    const result = transferSchema.safeParse({
      receiverAccount: "ACC-2002",
      amount: "0.00",
      currency: "BDT",
    });

    expect(result.success).toBe(false);
  });

  it("should reject negative amount", () => {
    const result = transferSchema.safeParse({
      receiverAccount: "ACC-2002",
      amount: "-100.00",
      currency: "BDT",
    });

    expect(result.success).toBe(false);
  });

  it("should reject non-numeric amount", () => {
    const result = transferSchema.safeParse({
      receiverAccount: "ACC-2002",
      amount: "abc",
      currency: "BDT",
    });

    expect(result.success).toBe(false);
  });

  it("should reject amount with more than 8 decimal places", () => {
    const result = transferSchema.safeParse({
      receiverAccount: "ACC-2002",
      amount: "100.123456789",
      currency: "BDT",
    });

    expect(result.success).toBe(false);
  });

  it("should reject an empty receiver account", () => {
    const result = transferSchema.safeParse({
      receiverAccount: "",
      amount: "5000.00",
      currency: "BDT",
    });

    expect(result.success).toBe(false);
  });

  it("should reject a request without receiver account", () => {
    const result = transferSchema.safeParse({
      amount: "5000.00",
      currency: "BDT",
    });

    expect(result.success).toBe(false);
  });

  it("should reject a request without amount", () => {
    const result = transferSchema.safeParse({
      receiverAccount: "ACC-2002",
      currency: "BDT",
    });

    expect(result.success).toBe(false);
  });

  it("should reject a request without currency", () => {
    const result = transferSchema.safeParse({
      receiverAccount: "ACC-2002",
      amount: "5000.00",
    });

    expect(result.success).toBe(false);
  });

  it("should reject client-provided sender account", () => {
    const result = transferSchema.safeParse({
      receiverAccount: "ACC-2002",
      amount: "5000.00",
      currency: "BDT",
      senderAccount: "ACC-1001",
    });

    expect(result.success).toBe(false);
  });

  it("should reject client-provided balance", () => {
    const result = transferSchema.safeParse({
      receiverAccount: "ACC-2002",
      amount: "5000.00",
      currency: "BDT",
      balance: "100000.00",
    });

    expect(result.success).toBe(false);
  });

  it("should reject client-provided status", () => {
    const result = transferSchema.safeParse({
      receiverAccount: "ACC-2002",
      amount: "5000.00",
      currency: "BDT",
      status: "COMPLETED",
    });

    expect(result.success).toBe(false);
  });

  it("should reject arbitrary extra fields", () => {
    const result = transferSchema.safeParse({
      receiverAccount: "ACC-2002",
      amount: "5000.00",
      currency: "BDT",
      anything: "unexpected",
    });

    expect(result.success).toBe(false);
  });
});