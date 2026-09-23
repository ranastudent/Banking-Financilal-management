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

describe("14.2.3 Sender Ownership / Authorization", () => {
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

  const createUser = async (
    namePrefix: string,
  ) => {
    const uniqueId =
      `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

    const user = await prisma.user.create({
      data: {
        name: `${namePrefix} ${uniqueId}`,
        email: `${namePrefix
          .toLowerCase()
          .replace(/\s+/g, "-")}-${uniqueId}@example.com`,
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

  it("should allow a CUSTOMER to transfer from an account they own", async () => {
    const user = await createUser(
      "Transfer Owner",
    );

    const sender = await createAccount(
      user.id,
      "TRF-OWNER-SENDER",
    );

    const receiver = await createAccount(
      user.id,
      "TRF-OWNER-RECEIVER",
    );

    await createBalance(sender.id);
    await createBalance(receiver.id);

    const result = await prepareTransfer(
      buildAuthUser(user),
      {
        senderAccount:
          sender.accountNumber,
        receiverAccount:
          receiver.accountNumber,
        amount: "100.00",
        currency: "BDT",
      },
    );

    createdTransactionIds.push(
      result.transaction.id,
    );

    expect(
      result.transaction.sourceAccountId,
    ).toBe(sender.id);

    expect(
      result.transaction.destinationAccountId,
    ).toBe(receiver.id);
  });

  it("should reject a CUSTOMER transferring from an account owned by another user", async () => {
    const senderOwner = await createUser(
      "Sender Owner",
    );

    const unauthorizedUser = await createUser(
      "Unauthorized User",
    );

    const receiverOwner = await createUser(
      "Receiver Owner",
    );

    const sender = await createAccount(
      senderOwner.id,
      "TRF-OTHER-SENDER",
    );

    const receiver = await createAccount(
      receiverOwner.id,
      "TRF-OTHER-RECEIVER",
    );

    /*
     * Balances are created so that the test reaches
     * the ownership authorization boundary.
     */
    await createBalance(sender.id);
    await createBalance(receiver.id);

    await expect(
      prepareTransfer(
        buildAuthUser(unauthorizedUser),
        {
          senderAccount:
            sender.accountNumber,
          receiverAccount:
            receiver.accountNumber,
          amount: "100.00",
          currency: "BDT",
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "FORBIDDEN",
    });

    /*
     * Verify that the sender balance was not changed.
     */
    const senderBalance =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId: sender.id,
            currencyCode: "BDT",
          },
        },
        select: {
          availableBalance: true,
        },
      });

    expect(
      senderBalance?.availableBalance.toString(),
    ).toBe("10000");
  });

  it("should reject a CUSTOMER from transferring from another user's account even when the receiver is owned by the CUSTOMER", async () => {
    const senderOwner = await createUser(
      "Another Sender Owner",
    );

    const customer = await createUser(
      "Customer",
    );

    const sender = await createAccount(
      senderOwner.id,
      "TRF-FOREIGN-SENDER",
    );

    const receiver = await createAccount(
      customer.id,
      "TRF-CUSTOMER-RECEIVER",
    );

    await createBalance(sender.id);
    await createBalance(receiver.id);

    await expect(
      prepareTransfer(
        buildAuthUser(customer),
        {
          senderAccount:
            sender.accountNumber,
          receiverAccount:
            receiver.accountNumber,
          amount: "100.00",
          currency: "BDT",
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "FORBIDDEN",
    });

    /*
     * Verify that neither account balance changed.
     */
    const balances =
      await prisma.accountBalance.findMany({
        where: {
          accountId: {
            in: [
              sender.id,
              receiver.id,
            ],
          },
          currencyCode: "BDT",
        },
        select: {
          accountId: true,
          availableBalance: true,
        },
      });

    for (const balance of balances) {
      expect(
        balance.availableBalance.toString(),
      ).toBe("10000");
    }
  });
});