import "../setup";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

import { env } from "../../config/env";
import { ErrorCode } from "../../errors/errorCodes";
import {
  assertDailyTransferLimit,
  assertDailyWithdrawalLimit,
} from "../../transaction/services/transaction-limits.service";

const aggregate = vi.fn();
const tx = {
  transaction: { aggregate },
} as unknown as Prisma.TransactionClient;

describe("Phase 27 daily transaction limits", () => {
  beforeEach(() => {
    aggregate.mockReset();
    aggregate.mockResolvedValue({
      _sum: { amount: new Prisma.Decimal(0) },
    });
  });

  it("allows a transfer that stays within the daily limit", async () => {
    aggregate.mockResolvedValueOnce({
      _sum: { amount: new Prisma.Decimal("90000") },
    });

    await expect(
      assertDailyTransferLimit(tx, {
        accountId: "source-account-id",
        currencyCode: "BDT",
        amount: new Prisma.Decimal("10000"),
        now: new Date("2026-10-24T10:00:00.000Z"),
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a transfer that exceeds the daily limit", async () => {
    aggregate.mockResolvedValueOnce({
      _sum: { amount: new Prisma.Decimal("90000") },
    });

    await expect(
      assertDailyTransferLimit(tx, {
        accountId: "source-account-id",
        currencyCode: "BDT",
        amount: new Prisma.Decimal("20000"),
        now: new Date("2026-10-24T10:00:00.000Z"),
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.TRANSACTION_LIMIT_EXCEEDED,
      statusCode: 409,
    });
  });

  it("rejects a withdrawal that exceeds the daily limit", async () => {
    aggregate.mockResolvedValueOnce({
      _sum: {
        amount: new Prisma.Decimal(env.transactionLimits.dailyWithdrawalLimit)
          .minus("1"),
      },
    });

    await expect(
      assertDailyWithdrawalLimit(tx, {
        accountId: "source-account-id",
        currencyCode: "BDT",
        amount: new Prisma.Decimal("2"),
        now: new Date("2026-10-24T10:00:00.000Z"),
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.TRANSACTION_LIMIT_EXCEEDED,
      statusCode: 409,
    });
  });

  it("queries transfers by source account, currency, business-day window and completed status", async () => {
    const now = new Date("2026-10-24T10:00:00.000Z");
    await assertDailyTransferLimit(tx, {
      accountId: "source-account-id",
      currencyCode: "BDT",
      amount: new Prisma.Decimal("100"),
      now,
    });

    const query = aggregate.mock.calls[0]![0];
    expect(query.where.sourceAccountId).toBe("source-account-id");
    expect(query.where.currencyCode).toBe("BDT");
    expect(query.where.type.in).toEqual(["INTERNAL_TRANSFER", "EXTERNAL_TRANSFER"]);
    expect(query.where.status.in).toEqual(["COMPLETED"]);
    expect(query.where.createdAt.gte.toISOString()).toBe("2026-10-23T18:00:00.000Z");
    expect(query.where.createdAt.lt.toISOString()).toBe("2026-10-24T18:00:00.000Z");
  });

  it("counts pending, processing and completed withdrawals because they reserve balance", async () => {
    await assertDailyWithdrawalLimit(tx, {
      accountId: "source-account-id",
      currencyCode: "BDT",
      amount: new Prisma.Decimal("100"),
      now: new Date("2026-10-24T10:00:00.000Z"),
    });

    const query = aggregate.mock.calls[0]![0];
    expect(query.where.type.in).toEqual(["WITHDRAWAL"]);
    expect(query.where.status.in).toEqual(["PENDING", "PROCESSING", "COMPLETED"]);
  });
});
