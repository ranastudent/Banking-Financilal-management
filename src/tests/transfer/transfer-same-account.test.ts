import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { prepareTransfer } from "../../transaction/services/transfer.service";
import type { AuthUser } from "../../types/auth";

describe("14.2.9 Same-Account Validation", () => {
  const createdUserIds: string[] = [];
  const createdAccountIds: string[] = [];
  const createdCurrencyCodes: string[] = [];

  beforeEach(() => {
    createdUserIds.length = 0;
    createdAccountIds.length = 0;
    createdCurrencyCodes.length = 0;
  });

  afterEach(async () => {
    /*
     * Delete audit logs associated with test users.
     */
    if (createdUserIds.length > 0) {
      await prisma.auditLog.deleteMany({
        where: {
          userId: {
            in: createdUserIds,
          },
        },
      });
    }

    /*
     * Delete account balances before accounts.
     */
    if (createdAccountIds.length > 0) {
      await prisma.accountBalance.deleteMany({
        where: {
          accountId: {
            in: createdAccountIds,
          },
        },
      });

      await prisma.account.deleteMany({
        where: {
          id: {
            in: createdAccountIds,
          },
        },
      });
    }

    /*
     * Delete test currencies.
     */
    if (createdCurrencyCodes.length > 0) {
      await prisma.currency.deleteMany({
        where: {
          code: {
            in: createdCurrencyCodes,
          },
        },
      });
    }

    /*
     * Delete user-related records before users.
     */
    if (createdUserIds.length > 0) {
      await prisma.refreshToken.deleteMany({
        where: {
          userId: {
            in: createdUserIds,
          },
        },
      });

      await prisma.emailVerificationOtp.deleteMany({
        where: {
          userId: {
            in: createdUserIds,
          },
        },
      });

      await prisma.user.deleteMany({
        where: {
          id: {
            in: createdUserIds,
          },
        },
      });
    }
  });

  const createUser = async () => {
    const uniqueId =
      `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

    const user = await prisma.user.create({
      data: {
        name: `Same Account User ${uniqueId}`,
        email: `same-account-${uniqueId}@example.com`,
        passwordHash: "test-password-hash",
        role: "CUSTOMER",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });

    createdUserIds.push(user.id);

    return user;
  };

  const createAccount = async (
    userId: string,
  ) => {
    const uniqueId =
      `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

    const account = await prisma.account.create({
      data: {
        userId,
        accountNumber: `TRF-SAME-${uniqueId}`,
        accountType: "SAVINGS",
        status: "ACTIVE",
      },
    });

    createdAccountIds.push(account.id);

    return account;
  };

  const createCurrency = async (
    code: string,
  ) => {
    const currency = await prisma.currency.create({
      data: {
        code,
        name: `Test Currency ${code}`,
        symbol: code,
        decimalPlaces: 2,
        isActive: true,
      },
    });

    createdCurrencyCodes.push(currency.code);

    return currency;
  };

  const createBalance = async (
    accountId: string,
    currencyCode: string,
    amount: string,
  ) => {
    return prisma.accountBalance.create({
      data: {
        accountId,
        currencyCode,
        availableBalance:
          new Prisma.Decimal(amount),
        lockedBalance:
          new Prisma.Decimal("0.00"),
      },
    });
  };

  const buildAuthUser = (
    user: Awaited<ReturnType<typeof createUser>>,
  ): AuthUser => ({
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
  });

  it("should reject a transfer when sender and receiver are the same account", async () => {
    const user = await createUser();

    const account = await createAccount(
      user.id,
    );

    const currencyCode = "TSA";

    await createCurrency(currencyCode);

    await createBalance(
      account.id,
      currencyCode,
      "10000.00",
    );

    await expect(
      prepareTransfer(
        buildAuthUser(user),
        {
          senderAccount:
            account.accountNumber,
          receiverAccount:
            account.accountNumber,
          amount: "100.00",
          currency: currencyCode,
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "BAD_REQUEST",
    });
  });

  it("should not change the account balance when a same-account transfer is rejected", async () => {
    const user = await createUser();

    const account = await createAccount(
      user.id,
    );

    const currencyCode = "TSB";

    await createCurrency(currencyCode);

    await createBalance(
      account.id,
      currencyCode,
      "10000.00",
    );

    const balanceBefore =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId: account.id,
            currencyCode,
          },
        },
        select: {
          availableBalance: true,
          lockedBalance: true,
        },
      });

    await expect(
      prepareTransfer(
        buildAuthUser(user),
        {
          senderAccount:
            account.accountNumber,
          receiverAccount:
            account.accountNumber,
          amount: "100.00",
          currency: currencyCode,
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "BAD_REQUEST",
    });

    const balanceAfter =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId: account.id,
            currencyCode,
          },
        },
        select: {
          availableBalance: true,
          lockedBalance: true,
        },
      });

    expect(
      balanceAfter?.availableBalance.toString(),
    ).toBe(
      balanceBefore?.availableBalance.toString(),
    );

    expect(
      balanceAfter?.lockedBalance.toString(),
    ).toBe(
      balanceBefore?.lockedBalance.toString(),
    );
  });

  it("should not create a transaction for a same-account transfer", async () => {
    const user = await createUser();

    const account = await createAccount(
      user.id,
    );

    const currencyCode = "TSC";

    await createCurrency(currencyCode);

    await createBalance(
      account.id,
      currencyCode,
      "10000.00",
    );

    const transactionCountBefore =
      await prisma.transaction.count();

    await expect(
      prepareTransfer(
        buildAuthUser(user),
        {
          senderAccount:
            account.accountNumber,
          receiverAccount:
            account.accountNumber,
          amount: "100.00",
          currency: currencyCode,
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "BAD_REQUEST",
    });

    const transactionCountAfter =
      await prisma.transaction.count();

    expect(
      transactionCountAfter,
    ).toBe(transactionCountBefore);
  });
});