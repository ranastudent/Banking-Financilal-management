import "../setup";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { Prisma } from "@prisma/client";

import { env } from "../../config/env";
import { prisma } from "../../config/prisma";

import { prepareWithdrawal } from "../../transaction/services/withdrawal.service";

import type { AuthUser } from "../../types/auth";

import { cleanupWithdrawalTestData } from "../helpers/withdrawal-test-cleanup";

describe("17.1 Concurrent Withdrawal Protection", () => {
  const createdUserIds: string[] = [];
  const createdAccountIds: string[] = [];
  const createdTransactionIds: string[] = [];

  beforeEach(() => {
    createdUserIds.length = 0;
    createdAccountIds.length = 0;
    createdTransactionIds.length = 0;
  });

  afterEach(async () => {
    await cleanupWithdrawalTestData({
      transactionIds: createdTransactionIds,
      accountIds: createdAccountIds,
      userIds: createdUserIds,
    });

    createdTransactionIds.length = 0;
    createdAccountIds.length = 0;
    createdUserIds.length = 0;
  });

  const createUser = async () => {
    const user = await prisma.user.create({
      data: {
        name: `Withdrawal Concurrency ${Date.now()}`,
        email: `withdrawal-concurrency-${Date.now()}-${Math.random()}@example.com`,
        passwordHash: "test-password-hash",
        role: "CUSTOMER",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });

    createdUserIds.push(user.id);

    return user;
  };

  const createAccount = async (userId: string) => {
    const account = await prisma.account.create({
      data: {
        userId,
        accountNumber: `WD-CONC-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
        accountType: "SAVINGS",
        status: "ACTIVE",
      },
    });

    createdAccountIds.push(account.id);

    return account;
  };

  const buildAuthUser = (
    user: Awaited<ReturnType<typeof createUser>>,
  ): AuthUser => ({
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
  });

  it(
    "should allow only one of two concurrent withdrawals when their combined amount exceeds the balance",
    async () => {
      /*
       * Both amounts must be within the configured
       * per-withdrawal transaction limit.
       */
      expect(
        new Prisma.Decimal(env.withdrawal.maxAmount).gte("8000"),
      ).toBe(true);

      const user = await createUser();

      const account = await createAccount(user.id);

      const balance = await prisma.accountBalance.create({
        data: {
          accountId: account.id,
          currencyCode: "BDT",
          availableBalance: new Prisma.Decimal("10000"),
          lockedBalance: new Prisma.Decimal("0"),
        },
      });

      const authUser = buildAuthUser(user);

      /*
       * Start both operations without awaiting either one.
       *
       * Promise.allSettled lets us inspect both outcomes
       * even when one withdrawal correctly fails.
       */
      const results = await Promise.allSettled([
        prepareWithdrawal(
          authUser,
          account.id,
          {
            amount: "8000",
            currency: "BDT",
          },
        ),

        prepareWithdrawal(
          authUser,
          account.id,
          {
            amount: "7000",
            currency: "BDT",
          },
        ),
      ]);

      const successful = results.filter(
        (
          result,
        ): result is PromiseFulfilledResult<
          Awaited<ReturnType<typeof prepareWithdrawal>>
        > => result.status === "fulfilled",
      );

      const failed = results.filter(
        (result) => result.status === "rejected",
      );

      /*
       * Exactly one withdrawal must succeed.
       */
      expect(successful).toHaveLength(1);
      expect(failed).toHaveLength(1);

      /*
       * The losing request must fail because
       * the remaining balance is insufficient.
       */
      const failedWithdrawal = failed[0];

            expect(failedWithdrawal).toBeDefined();

            if (!failedWithdrawal) {
            throw new Error("Expected one withdrawal to fail");
            }

            expect(failedWithdrawal.reason).toMatchObject({
            statusCode: 409,
            code: "INSUFFICIENT_BALANCE",
        });

      /*
       * Track the successful transaction for cleanup.
       */
      const successfulResult = successful[0];

        expect(successfulResult).toBeDefined();

        if (!successfulResult) {
        throw new Error("Expected one withdrawal to succeed");
        }

        const successfulWithdrawal = successfulResult.value;

      createdTransactionIds.push(
        successfulWithdrawal.transaction.id,
      );

      /*
       * Read the committed balance from PostgreSQL.
       */
      const finalBalance = await prisma.accountBalance.findUnique({
        where: {
          id: balance.id,
        },
      });

      expect(finalBalance).not.toBeNull();

      const finalAvailableBalance =
        finalBalance!.availableBalance;

      /*
       * Either 8,000 or 7,000 may win.
       *
       * If 8,000 wins, 2,000 remains.
       * If 7,000 wins, 3,000 remains.
       */
      expect(
        [
          "2000",
          "3000",
        ],
      ).toContain(finalAvailableBalance.toString());

      /*
       * The balance must never be negative.
       */
      expect(
        finalAvailableBalance.gte(0),
      ).toBe(true);

      /*
       * Exactly one withdrawal transaction should exist
       * for this account.
       */
      const withdrawalCount = await prisma.transaction.count({
        where: {
          sourceAccountId: account.id,
          type: "WITHDRAWAL",
        },
      });

      expect(withdrawalCount).toBe(1);

      /*
       * Exactly one debit ledger entry should exist.
       */
      const debitLedgerCount = await prisma.ledgerEntry.count({
        where: {
          accountId: account.id,
          entryType: "DEBIT",
        },
      });

      expect(debitLedgerCount).toBe(1);
    },
  );
});