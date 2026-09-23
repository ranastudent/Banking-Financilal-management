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

describe("14.2.8 Amount / Sufficient Balance Validation", () => {
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
        name: `Transfer Amount User ${uniqueId}`,
        email: `transfer-amount-${uniqueId}@example.com`,
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
        availableBalance: new Prisma.Decimal(
          amount,
        ),
        lockedBalance: new Prisma.Decimal(
          "0.00",
        ),
      },
    });
  };

  const getBalance = async (
    accountId: string,
    currencyCode: string,
  ) => {
    return prisma.accountBalance.findUnique({
      where: {
        accountId_currencyCode: {
          accountId,
          currencyCode,
        },
      },
      select: {
        availableBalance: true,
        lockedBalance: true,
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

  it("should allow a transfer when the amount is less than the sender balance", async () => {
    const user = await createUser();

    const sender = await createAccount(
      user.id,
      "TRF-AMOUNT-LESS-SENDER",
    );

    const receiver = await createAccount(
      user.id,
      "TRF-AMOUNT-LESS-RECEIVER",
    );

    const currencyCode = "TAL";

    await createCurrency(currencyCode);

    await createBalance(
      sender.id,
      currencyCode,
      "10000.00",
    );

    await createBalance(
      receiver.id,
      currencyCode,
      "1000.00",
    );

    const result = await prepareTransfer(
      buildAuthUser(user),
      {
        senderAccount:
          sender.accountNumber,
        receiverAccount:
          receiver.accountNumber,
        amount: "3000.00",
        currency: currencyCode,
      },
    );

    createdTransactionIds.push(
      result.transaction.id,
    );

    expect(
      result.transaction.status,
    ).toBe("COMPLETED");

    expect(
      result.transaction.amount,
    ).toBe("3000");

    const senderBalance =
      await getBalance(
        sender.id,
        currencyCode,
      );

    const receiverBalance =
      await getBalance(
        receiver.id,
        currencyCode,
      );

    expect(
      senderBalance?.availableBalance.toString(),
    ).toBe("7000");

    expect(
      receiverBalance?.availableBalance.toString(),
    ).toBe("4000");
  });

  it("should allow a transfer when the amount exactly equals the sender balance", async () => {
    const user = await createUser();

    const sender = await createAccount(
      user.id,
      "TRF-AMOUNT-EXACT-SENDER",
    );

    const receiver = await createAccount(
      user.id,
      "TRF-AMOUNT-EXACT-RECEIVER",
    );

    const currencyCode = "TAE";

    await createCurrency(currencyCode);

    await createBalance(
      sender.id,
      currencyCode,
      "5000.00",
    );

    await createBalance(
      receiver.id,
      currencyCode,
      "1000.00",
    );

    const result = await prepareTransfer(
      buildAuthUser(user),
      {
        senderAccount:
          sender.accountNumber,
        receiverAccount:
          receiver.accountNumber,
        amount: "5000.00",
        currency: currencyCode,
      },
    );

    createdTransactionIds.push(
      result.transaction.id,
    );

    expect(
      result.transaction.status,
    ).toBe("COMPLETED");

    const senderBalance =
      await getBalance(
        sender.id,
        currencyCode,
      );

    const receiverBalance =
      await getBalance(
        receiver.id,
        currencyCode,
      );

    expect(
      senderBalance?.availableBalance.toString(),
    ).toBe("0");

    expect(
      receiverBalance?.availableBalance.toString(),
    ).toBe("6000");
  });

  it("should reject a transfer when the amount is greater than the sender balance", async () => {
    const user = await createUser();

    const sender = await createAccount(
      user.id,
      "TRF-INSUFFICIENT-SENDER",
    );

    const receiver = await createAccount(
      user.id,
      "TRF-INSUFFICIENT-RECEIVER",
    );

    const currencyCode = "TIF";

    await createCurrency(currencyCode);

    await createBalance(
      sender.id,
      currencyCode,
      "1000.00",
    );

    await createBalance(
      receiver.id,
      currencyCode,
      "2000.00",
    );

    await expect(
      prepareTransfer(
        buildAuthUser(user),
        {
          senderAccount:
            sender.accountNumber,
          receiverAccount:
            receiver.accountNumber,
          amount: "1000.01",
          currency: currencyCode,
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "INSUFFICIENT_BALANCE",
    });
  });

  it("should not change either balance when the sender has insufficient funds", async () => {
    const user = await createUser();

    const sender = await createAccount(
      user.id,
      "TRF-INSUFFICIENT-INTEGRITY-SENDER",
    );

    const receiver = await createAccount(
      user.id,
      "TRF-INSUFFICIENT-INTEGRITY-RECEIVER",
    );

    const currencyCode = "TII";

    await createCurrency(currencyCode);

    await createBalance(
      sender.id,
      currencyCode,
      "1000.00",
    );

    await createBalance(
      receiver.id,
      currencyCode,
      "2000.00",
    );

    const senderBefore =
      await getBalance(
        sender.id,
        currencyCode,
      );

    const receiverBefore =
      await getBalance(
        receiver.id,
        currencyCode,
      );

    await expect(
      prepareTransfer(
        buildAuthUser(user),
        {
          senderAccount:
            sender.accountNumber,
          receiverAccount:
            receiver.accountNumber,
          amount: "1000.01",
          currency: currencyCode,
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "INSUFFICIENT_BALANCE",
    });

    const senderAfter =
      await getBalance(
        sender.id,
        currencyCode,
      );

    const receiverAfter =
      await getBalance(
        receiver.id,
        currencyCode,
      );

    expect(
      senderAfter?.availableBalance.toString(),
    ).toBe(
      senderBefore?.availableBalance.toString(),
    );

    expect(
      receiverAfter?.availableBalance.toString(),
    ).toBe(
      receiverBefore?.availableBalance.toString(),
    );
  });
});