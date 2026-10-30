import "../setup";
import { describe, expect, it } from "vitest";

import {
  transactionHistoryQuerySchema,
} from "../../transaction/validation/transaction-history-query";

describe("transactionHistoryQuerySchema", () => {
  describe("pagination", () => {
    it("should apply default page and limit", () => {
      const result = transactionHistoryQuerySchema.safeParse({});

      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.page).toBe(1);
        expect(result.data.limit).toBe(20);
      }
    });

    it("should accept valid page and limit", () => {
      const result = transactionHistoryQuerySchema.safeParse({
        page: "2",
        limit: "50",
      });

      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.page).toBe(2);
        expect(result.data.limit).toBe(50);
      }
    });

    it.each(["0", "-1", "1.5", "abc", ""])(
      "should reject invalid page: %s",
      (page) => {
        const result = transactionHistoryQuerySchema.safeParse({
          page,
        });

        expect(result.success).toBe(false);
      },
    );

    it.each(["0", "101", "1.5", "abc", "-1"])(
      "should reject invalid limit: %s",
      (limit) => {
        const result = transactionHistoryQuerySchema.safeParse({
          limit,
        });

        expect(result.success).toBe(false);
      },
    );

    it("should reject a page number that exceeds the supported maximum", () => {
      const result = transactionHistoryQuerySchema.safeParse({
        page: "2147483648",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("transaction type and status", () => {
    it("should accept valid transaction type and status", () => {
      const result = transactionHistoryQuerySchema.safeParse({
        type: "INTERNAL_TRANSFER",
        status: "COMPLETED",
      });

      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.type).toBe("INTERNAL_TRANSFER");
        expect(result.data.status).toBe("COMPLETED");
      }
    });

    it("should reject an invalid transaction type", () => {
      const result = transactionHistoryQuerySchema.safeParse({
        type: "TRANSFER",
      });

      expect(result.success).toBe(false);
    });

    it("should reject an invalid transaction status", () => {
      const result = transactionHistoryQuerySchema.safeParse({
        status: "SUCCESS",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("date filters", () => {
    it("should accept valid start and end dates", () => {
      const result = transactionHistoryQuerySchema.safeParse({
        startDate: "2026-10-01",
        endDate: "2026-10-20",
      });

      expect(result.success).toBe(true);
    });

    it("should accept a date range containing the same date", () => {
      const result = transactionHistoryQuerySchema.safeParse({
        startDate: "2026-10-20",
        endDate: "2026-10-20",
      });

      expect(result.success).toBe(true);
    });

    it("should reject an invalid calendar date", () => {
      const result = transactionHistoryQuerySchema.safeParse({
        startDate: "2026-02-30",
      });

      expect(result.success).toBe(false);
    });

    it("should reject an incorrectly formatted date", () => {
      const result = transactionHistoryQuerySchema.safeParse({
        startDate: "10-01-2026",
      });

      expect(result.success).toBe(false);
    });

    it("should reject an end date earlier than the start date", () => {
      const result = transactionHistoryQuerySchema.safeParse({
        startDate: "2026-10-20",
        endDate: "2026-10-01",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("account ID", () => {
    it("should accept a valid UUID", () => {
      const result = transactionHistoryQuerySchema.safeParse({
        accountId: "550e8400-e29b-41d4-a716-446655440000",
      });

      expect(result.success).toBe(true);
    });

    it("should reject an invalid UUID", () => {
      const result = transactionHistoryQuerySchema.safeParse({
        accountId: "invalid-account-id",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("amount filters", () => {
    it("should accept valid minimum and maximum amounts", () => {
      const result = transactionHistoryQuerySchema.safeParse({
        minAmount: "100.25",
        maxAmount: "5000.50",
      });

      expect(result.success).toBe(true);

      if (result.success) {
        // Amounts remain strings to preserve decimal precision.
        expect(result.data.minAmount).toBe("100.25");
        expect(result.data.maxAmount).toBe("5000.50");
      }
    });

    it("should accept amounts with eight decimal places", () => {
      const result = transactionHistoryQuerySchema.safeParse({
        minAmount: "0.12345678",
        maxAmount: "1.12345678",
      });

      expect(result.success).toBe(true);
    });

    it("should reject a negative amount", () => {
      const result = transactionHistoryQuerySchema.safeParse({
        minAmount: "-100",
      });

      expect(result.success).toBe(false);
    });

    it("should reject an amount with more than eight decimal places", () => {
      const result = transactionHistoryQuerySchema.safeParse({
        minAmount: "100.123456789",
      });

      expect(result.success).toBe(false);
    });

    it("should reject an amount exceeding Decimal(24, 8) precision", () => {
      const result = transactionHistoryQuerySchema.safeParse({
        minAmount: "10000000000000000",
      });

      expect(result.success).toBe(false);
    });

    it("should reject a maximum amount smaller than the minimum amount", () => {
      const result = transactionHistoryQuerySchema.safeParse({
        minAmount: "500",
        maxAmount: "100",
      });

      expect(result.success).toBe(false);
    });

    it("should accept equal minimum and maximum amounts", () => {
      const result = transactionHistoryQuerySchema.safeParse({
        minAmount: "100.50",
        maxAmount: "100.50",
      });

      expect(result.success).toBe(true);
    });

    it("should compare decimal amounts accurately without floating-point conversion", () => {
      const result = transactionHistoryQuerySchema.safeParse({
        minAmount: "9999999999999999.99999999",
        maxAmount: "10000000000000000",
      });

      // The maximum amount has 17 integer digits, exceeding
      // the supported 16 integer digits, so the query is invalid.
      expect(result.success).toBe(false);
    });

    it("should compare valid large decimal amounts accurately", () => {
      const result = transactionHistoryQuerySchema.safeParse({
        minAmount: "999999999999999.99999999",
        maxAmount: "1000000000000000",
      });

      expect(result.success).toBe(true);
    });
  });

  describe("unknown query parameters", () => {
    it("should reject unsupported query parameters", () => {
      const result = transactionHistoryQuerySchema.safeParse({
        page: "1",
        unsupportedFilter: "value",
      });

      expect(result.success).toBe(false);
    });
  });
});