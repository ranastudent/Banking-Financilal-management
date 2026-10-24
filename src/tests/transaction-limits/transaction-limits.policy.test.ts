import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";

import { env } from "../../config/env";
import {
  assertTransferAmountWithinLimits,
  getDailyWindow,
} from "../../transaction/policies/transaction-limits.policy";
import { ErrorCode } from "../../errors/errorCodes";

describe("Phase 27 transaction-limit policy", () => {
  it("accepts a transfer exactly at the minimum", () => {
    expect(() =>
      assertTransferAmountWithinLimits(
        new Prisma.Decimal(env.transactionLimits.transferMinAmount),
      ),
    ).not.toThrow();
  });

  it("rejects a transfer below the minimum", () => {
    const belowMinimum = new Prisma.Decimal(
      env.transactionLimits.transferMinAmount,
    ).div(10);

    try {
      assertTransferAmountWithinLimits(belowMinimum);
      throw new Error("Expected minimum-limit validation to reject the amount");
    } catch (error) {
      expect(error).toMatchObject({
        code: ErrorCode.TRANSACTION_LIMIT_EXCEEDED,
      });
    }
  });

  it("accepts a transfer exactly at the maximum", () => {
    expect(() =>
      assertTransferAmountWithinLimits(
        new Prisma.Decimal(env.transactionLimits.transferMaxAmount),
      ),
    ).not.toThrow();
  });

  it("rejects a transfer above the maximum", () => {
    const aboveMaximum = new Prisma.Decimal(
      env.transactionLimits.transferMaxAmount,
    ).add("0.01");

    try {
      assertTransferAmountWithinLimits(aboveMaximum);
      throw new Error("Expected maximum-limit validation to reject the amount");
    } catch (error) {
      expect(error).toMatchObject({
        code: ErrorCode.TRANSACTION_LIMIT_EXCEEDED,
      });
    }
  });

  it("calculates the daily window using the configured Bangladesh timezone", () => {
    // 2026-10-23 18:30 UTC is midnight in Dhaka on 2026-10-24.
    const instant = new Date("2026-10-23T18:30:00.000Z");
    const window = getDailyWindow(instant, "Asia/Dhaka");

    expect(window.start.toISOString()).toBe("2026-10-23T18:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-10-24T18:00:00.000Z");
    expect(instant.getTime()).toBeGreaterThanOrEqual(window.start.getTime());
    expect(instant.getTime()).toBeLessThan(window.end.getTime());
  });

  it("places the exact next midnight in the next daily window", () => {
    const exactMidnight = new Date("2026-10-24T18:00:00.000Z");
    const window = getDailyWindow(exactMidnight, "Asia/Dhaka");

    expect(window.start.toISOString()).toBe("2026-10-24T18:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-10-25T18:00:00.000Z");
  });
});
