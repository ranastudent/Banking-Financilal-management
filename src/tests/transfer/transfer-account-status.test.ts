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

describe("14.2.4 Account Status Validation", () => {
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
    status:
      | "ACTIVE"
      | "FROZEN"
      | "CLOSED" = "ACTIVE",
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
        status,
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

  it("should allow a transfer when both sender and receiver accounts are ACTIVE", async () => {
    const user = await createUser(
      "Active Account User",
    );

    const sender = await createAccount(
      user.id,
      "TRF-ACTIVE-SENDER",
      "ACTIVE",
    );

    const receiver = await createAccount(
      user.id,
      "TRF-ACTIVE-RECEIVER",
      "ACTIVE",
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
      result.transaction.status,
    ).toBe("COMPLETED");

    expect(
      result.transaction.sourceAccountId,
    ).toBe(sender.id);

    expect(
      result.transaction.destinationAccountId,
    ).toBe(receiver.id);
  });

  it("should reject a transfer when the sender account is FROZEN", async () => {
    const user = await createUser(
      "Frozen Sender User",
    );

    const sender = await createAccount(
      user.id,
      "TRF-FROZEN-SENDER",
      "FROZEN",
    );

    const receiver = await createAccount(
      user.id,
      "TRF-FROZEN-RECEIVER",
      "ACTIVE",
    );

    await createBalance(sender.id);
    await createBalance(receiver.id);

    await expect(
      prepareTransfer(
        buildAuthUser(user),
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
      statusCode: 409,
      code: "CONFLICT",
    });
  });

  it("should reject a transfer when the sender account is CLOSED", async () => {
    const user = await createUser(
      "Closed Sender User",
    );

    const sender = await createAccount(
      user.id,
      "TRF-CLOSED-SENDER",
      "CLOSED",
    );

    const receiver = await createAccount(
      user.id,
      "TRF-CLOSED-RECEIVER",
      "ACTIVE",
    );

    await createBalance(sender.id);
    await createBalance(receiver.id);

    await expect(
      prepareTransfer(
        buildAuthUser(user),
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
      statusCode: 409,
      code: "CONFLICT",
    });
  });

  it("should reject a transfer when the receiver account is FROZEN", async () => {
    const user = await createUser(
      "Frozen Receiver User",
    );

    const sender = await createAccount(
      user.id,
      "TRF-FROZEN-RECEIVER-SENDER",
      "ACTIVE",
    );

    const receiver = await createAccount(
      user.id,
      "TRF-FROZEN-RECEIVER",
      "FROZEN",
    );

    await createBalance(sender.id);
    await createBalance(receiver.id);

    await expect(
      prepareTransfer(
        buildAuthUser(user),
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
      statusCode: 409,
      code: "CONFLICT",
    });
  });

  it("should reject a transfer when the receiver account is CLOSED", async () => {
    const user = await createUser(
      "Closed Receiver User",
    );

    const sender = await createAccount(
      user.id,
      "TRF-CLOSED-RECEIVER-SENDER",
      "ACTIVE",
    );

    const receiver = await createAccount(
      user.id,
      "TRF-CLOSED-RECEIVER",
      "CLOSED",
    );

    await createBalance(sender.id);
    await createBalance(receiver.id);

    await expect(
      prepareTransfer(
        buildAuthUser(user),
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
      statusCode: 409,
      code: "CONFLICT",
    });
  });
});