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

describe("14.2.2 Receiver Account Validation", () => {
  const createdUserIds: string[] = [];
  const createdAccountIds: string[] = [];
  const createdTransactionIds: string[] = [];

  beforeEach(() => {
    createdUserIds.length = 0;
    createdAccountIds.length = 0;
    createdTransactionIds.length = 0;
  });

  afterEach(async () => {
    /*
     * Transaction legs reference transactions.
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
       * Ledger entries reference transactions.
       */
      await prisma.ledgerEntry.deleteMany({
        where: {
          transactionId: {
            in: createdTransactionIds,
          },
        },
      });

      /*
       * Finally delete transactions.
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
     * Audit logs are linked to the test users.
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
    const user = await prisma.user.create({
      data: {
        name: `Transfer Receiver ${Date.now()}`,
        email: `transfer-receiver-${Date.now()}-${Math.random()}@example.com`,
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
    accountNumber: string,
  ) => {
    const account = await prisma.account.create({
      data: {
        userId,
        accountNumber,
        accountType: "SAVINGS",
        status: "ACTIVE",
      },
    });

    createdAccountIds.push(account.id);

    return account;
  };

  const createBalance = async (
    accountId: string,
  ) => {
    return prisma.accountBalance.create({
      data: {
        accountId,
        currencyCode: "BDT",
        availableBalance: "10000.00",
        lockedBalance: "0.00",
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

  it("should accept an existing receiver account", async () => {
    const user = await createUser();

    const sender = await createAccount(
      user.id,
      `TRF-SENDER-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );

    const receiver = await createAccount(
      user.id,
      `TRF-RECEIVER-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );

    /*
     * Both accounts need a BDT balance
     * so the transfer can complete.
     */
    await createBalance(sender.id);
    await createBalance(receiver.id);

    const result = await prepareTransfer(
      buildAuthUser(user),
      {
        senderAccount: sender.accountNumber,
        receiverAccount: receiver.accountNumber,
        amount: "100.00",
        currency: "BDT",
      },
    );

    createdTransactionIds.push(
      result.transaction.id,
    );

    expect(
      result.transaction.destinationAccountId,
    ).toBe(receiver.id);

    expect(
      result.transaction.sourceAccountId,
    ).toBe(sender.id);

    expect(
      result.transaction.amount,
    ).toBe("100");

    expect(
      result.transaction.currencyCode,
    ).toBe("BDT");
  });

  it("should reject when receiver account does not exist even if sender exists", async () => {
    const user = await createUser();

    const sender = await createAccount(
      user.id,
      `TRF-SENDER-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );

    await expect(
      prepareTransfer(
        buildAuthUser(user),
        {
          senderAccount: sender.accountNumber,
          receiverAccount: "ACC-MISSING-RECEIVER",
          amount: "100.00",
          currency: "BDT",
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "RESOURCE_NOT_FOUND",
    });
  });

  it("should reject a non-existent receiver account", async () => {
    const user = await createUser();

    const sender = await createAccount(
      user.id,
      `TRF-SENDER-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );

    await expect(
      prepareTransfer(
        buildAuthUser(user),
        {
          senderAccount: sender.accountNumber,
          receiverAccount: "ACC-NON-EXISTENT",
          amount: "500.00",
          currency: "BDT",
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "RESOURCE_NOT_FOUND",
    });
  });
});