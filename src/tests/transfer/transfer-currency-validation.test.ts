import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { prisma } from "../../config/prisma";
import { prepareTransfer } from "../../transaction/services/transfer.service";
import type { AuthUser } from "../../types/auth";

describe("14.2.5 Currency Validation", () => {
  const createdUserIds: string[] = [];
  const createdAccountIds: string[] = [];
  const createdTransactionIds: string[] = [];
  const createdCurrencyCodes: string[] = [];

  beforeEach(() => {
    createdUserIds.length = 0;
    createdAccountIds.length = 0;
    createdTransactionIds.length = 0;
    createdCurrencyCodes.length = 0;
  });

  afterEach(async () => {
    /*
     * Transaction legs must be deleted before transactions.
     */
    if (createdTransactionIds.length > 0) {
      await prisma.transactionLeg.deleteMany({
        where: {
          transactionId: {
            in: createdTransactionIds,
          },
        },
      });

      /*
       * Ledger entries must be deleted before transactions.
       */
      await prisma.ledgerEntry.deleteMany({
        where: {
          transactionId: {
            in: createdTransactionIds,
          },
        },
      });

      /*
       * Delete transactions after dependent records.
       */
      await prisma.transaction.deleteMany({
        where: {
          id: {
            in: createdTransactionIds,
          },
        },
      });
    }

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
     * Delete test currencies only after all dependent
     * transfer data has been removed.
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
        name: `Transfer Currency User ${uniqueId}`,
        email: `transfer-currency-${uniqueId}@example.com`,
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
    accountPrefix: string,
  ) => {
    const uniqueId =
      `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

    const account = await prisma.account.create({
      data: {
        userId,
        accountNumber: `${accountPrefix}-${uniqueId}`,
        accountType: "SAVINGS",
        status: "ACTIVE",
      },
    });

    createdAccountIds.push(account.id);

    return account;
  };

  const createBalance = async (
    accountId: string,
    currencyCode: string,
  ) => {
    return prisma.accountBalance.create({
      data: {
        accountId,
        currencyCode,
        availableBalance: "10000.00",
        lockedBalance: "0.00",
      },
    });
  };

  const createCurrency = async (
    code: string,
    isActive: boolean,
  ) => {
    const currency = await prisma.currency.create({
      data: {
        code,
        name: `Test Currency ${code}`,
        symbol: code,
        decimalPlaces: 2,
        isActive,
      },
    });

    createdCurrencyCodes.push(currency.code);

    return currency;
  };

  const buildAuthUser = (
    user: Awaited<ReturnType<typeof createUser>>,
  ): AuthUser => ({
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
  });

  it("should accept an existing active currency", async () => {
    const user = await createUser();

    const sender = await createAccount(
      user.id,
      "TRF-CURRENCY-SENDER",
    );

    const receiver = await createAccount(
      user.id,
      "TRF-CURRENCY-RECEIVER",
    );

    /*
     * Use a unique currency so the test does not depend
     * on a pre-existing database seed.
     */
    const currencyCode = "TCA";

    await createCurrency(
      currencyCode,
      true,
    );

    await createBalance(
      sender.id,
      currencyCode,
    );

    await createBalance(
      receiver.id,
      currencyCode,
    );

    const result = await prepareTransfer(
      buildAuthUser(user),
      {
        senderAccount:
          sender.accountNumber,
        receiverAccount:
          receiver.accountNumber,
        amount: "100.00",
        currency: currencyCode,
      },
    );

    createdTransactionIds.push(
      result.transaction.id,
    );

    expect(
      result.transaction.currencyCode,
    ).toBe(currencyCode);

    expect(
      result.transaction.status,
    ).toBe("COMPLETED");
  });

  it("should reject a non-existent currency", async () => {
    const user = await createUser();

    const sender = await createAccount(
      user.id,
      "TRF-MISSING-CURRENCY-SENDER",
    );

    const receiver = await createAccount(
      user.id,
      "TRF-MISSING-CURRENCY-RECEIVER",
    );

    await expect(
      prepareTransfer(
        buildAuthUser(user),
        {
          senderAccount:
            sender.accountNumber,
          receiverAccount:
            receiver.accountNumber,
          amount: "100.00",
          currency: "ZZZ",
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "RESOURCE_NOT_FOUND",
    });
  });

  it("should reject an inactive currency", async () => {
    const user = await createUser();

    const sender = await createAccount(
      user.id,
      "TRF-INACTIVE-CURRENCY-SENDER",
    );

    const receiver = await createAccount(
      user.id,
      "TRF-INACTIVE-CURRENCY-RECEIVER",
    );

    const currencyCode = "TCI";

    await createCurrency(
      currencyCode,
      false,
    );

    await expect(
      prepareTransfer(
        buildAuthUser(user),
        {
          senderAccount:
            sender.accountNumber,
          receiverAccount:
            receiver.accountNumber,
          amount: "100.00",
          currency: currencyCode,
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "CONFLICT",
    });
  });
});