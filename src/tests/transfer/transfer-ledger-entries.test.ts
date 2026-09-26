import request from "supertest";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { generateAccessToken } from "../../auth/utils/jwt";

describe("Fund Transfer - Ledger Entries", () => {
  const createdUserIds: string[] = [];
  const createdAccountIds: string[] = [];
  const createdTransactionIds: string[] = [];
  const createdIdempotencyRecordIds: string[] = [];

  afterEach(async () => {
    /*
     * --------------------------------------------------------
     * Delete idempotency records
     * --------------------------------------------------------
     */

    if (createdIdempotencyRecordIds.length > 0) {
      await prisma.idempotencyRecord.deleteMany({
        where: {
          id: {
            in: createdIdempotencyRecordIds,
          },
        },
      });
    }

    /*
     * --------------------------------------------------------
     * Delete ledger entries and transaction legs
     * before deleting transactions.
     * --------------------------------------------------------
     */

    if (createdTransactionIds.length > 0) {
      await prisma.ledgerEntry.deleteMany({
        where: {
          transactionId: {
            in: createdTransactionIds,
          },
        },
      });

      await prisma.transactionLeg.deleteMany({
        where: {
          transactionId: {
            in: createdTransactionIds,
          },
        },
      });

      await prisma.transaction.deleteMany({
        where: {
          id: {
            in: createdTransactionIds,
          },
        },
      });
    }

    /*
     * --------------------------------------------------------
     * Delete account balances and accounts.
     * --------------------------------------------------------
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
     * --------------------------------------------------------
     * Delete user-dependent records.
     * --------------------------------------------------------
     */

    if (createdUserIds.length > 0) {
      await prisma.auditLog.deleteMany({
        where: {
          userId: {
            in: createdUserIds,
          },
        },
      });

      await prisma.idempotencyRecord.deleteMany({
        where: {
          userId: {
            in: createdUserIds,
          },
        },
      });

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

    createdIdempotencyRecordIds.length = 0;
    createdTransactionIds.length = 0;
    createdAccountIds.length = 0;
    createdUserIds.length = 0;
  });

  /*
   * --------------------------------------------------------
   * Test helpers
   * --------------------------------------------------------
   */

  const createUser = async () => {
    const user = await prisma.user.create({
      data: {
        name: `Ledger Test User ${Date.now()}-${Math.random()}`,
        email: `ledger-${Date.now()}-${Math.random()}@example.com`,
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

  const createBdtBalance = async (
    accountId: string,
    availableBalance: string,
  ) => {
    return prisma.accountBalance.create({
      data: {
        accountId,
        currencyCode: "BDT",
        availableBalance,
        lockedBalance: "0",
      },
    });
  };

  const createAccessToken = (user: {
    id: string;
    email: string;
    role:
      | "CUSTOMER"
      | "ADMIN"
      | "SUPPORT"
      | "AUDITOR";
  }) => {
    return generateAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
      status: "ACTIVE",
    });
  };

  const createIdempotencyKey = () => {
    return `ledger-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  };

  /*
   * ========================================================
   * 14.11.1
   *
   * One transfer creates exactly two ledger entries.
   * ========================================================
   */

  it("should create exactly two ledger entries for one transfer", async () => {
    const sender = await createUser();
    const receiver = await createUser();

    const senderAccount = await createAccount(
      sender.id,
      `ACC-LEDGER-S-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );

    const receiverAccount = await createAccount(
      receiver.id,
      `ACC-LEDGER-R-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );

    /*
     * Initial balances:
     *
     * Sender   = 10000
     * Receiver = 2000
     */

    await createBdtBalance(
      senderAccount.id,
      "10000",
    );

    await createBdtBalance(
      receiverAccount.id,
      "2000",
    );

    const accessToken =
      createAccessToken(sender);

    const idempotencyKey =
      createIdempotencyKey();

    const response = await request(app)
      .post("/api/v1/transfers")
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      )
      .set(
        "Idempotency-Key",
        idempotencyKey,
      )
      .send({
        senderAccount:
          senderAccount.accountNumber,
        receiverAccount:
          receiverAccount.accountNumber,
        amount: "5000",
        currency: "BDT",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    /*
     * ------------------------------------------------------
     * Find the created transaction.
     * ------------------------------------------------------
     */

    const transactions =
      await prisma.transaction.findMany({
        where: {
          sourceAccountId:
            senderAccount.id,

          destinationAccountId:
            receiverAccount.id,

          type: "INTERNAL_TRANSFER",
        },
      });

    expect(transactions).toHaveLength(1);

    const transaction = transactions[0];

    expect(transaction).toBeDefined();

    if (!transaction) {
      throw new Error(
        "Expected exactly one transfer transaction",
      );
    }

    createdTransactionIds.push(
      transaction.id,
    );

    /*
     * ------------------------------------------------------
     * Find ledger entries belonging to this transaction.
     * ------------------------------------------------------
     */

    const ledgerEntries =
      await prisma.ledgerEntry.findMany({
        where: {
          transactionId: transaction.id,
        },
        orderBy: {
          createdAt: "asc",
        },
      });

    /*
     * One transfer must create exactly:
     *
     * 1 DEBIT
     * 1 CREDIT
     */

    expect(ledgerEntries).toHaveLength(2);

    /*
     * ------------------------------------------------------
     * Verify DEBIT and CREDIT exist.
     * ------------------------------------------------------
     */

    const debitEntry =
      ledgerEntries.find(
        (entry) =>
          entry.entryType === "DEBIT",
      );

    const creditEntry =
      ledgerEntries.find(
        (entry) =>
          entry.entryType === "CREDIT",
      );

    expect(debitEntry).toBeDefined();
    expect(creditEntry).toBeDefined();

    if (!debitEntry || !creditEntry) {
      throw new Error(
        "Expected both DEBIT and CREDIT ledger entries",
      );
    }

    /*
     * ------------------------------------------------------
     * Verify sender DEBIT.
     * ------------------------------------------------------
     */

    expect(debitEntry.transactionId).toBe(
      transaction.id,
    );

    expect(debitEntry.accountId).toBe(
      senderAccount.id,
    );

    expect(debitEntry.currencyCode).toBe(
      "BDT",
    );

    expect(debitEntry.entryType).toBe(
      "DEBIT",
    );

    expect(debitEntry.amount.toString()).toBe(
      "5000",
    );

    /*
     * Sender:
     *
     * Before = 10000
     * After  = 5000
     */

    expect(
      debitEntry.balanceBefore.toString(),
    ).toBe("10000");

    expect(
      debitEntry.balanceAfter.toString(),
    ).toBe("5000");

    /*
     * ------------------------------------------------------
     * Verify receiver CREDIT.
     * ------------------------------------------------------
     */

    expect(creditEntry.transactionId).toBe(
      transaction.id,
    );

    expect(creditEntry.accountId).toBe(
      receiverAccount.id,
    );

    expect(creditEntry.currencyCode).toBe(
      "BDT",
    );

    expect(creditEntry.entryType).toBe(
      "CREDIT",
    );

    expect(creditEntry.amount.toString()).toBe(
      "5000",
    );

    /*
     * Receiver:
     *
     * Before = 2000
     * After  = 7000
     */

    expect(
      creditEntry.balanceBefore.toString(),
    ).toBe("2000");

    expect(
      creditEntry.balanceAfter.toString(),
    ).toBe("7000");
  });

  /*
   * ========================================================
   * 14.11.2
   *
   * Both ledger entries must belong to the same
   * transaction and preserve the same currency/amount.
   * ========================================================
   */

  it("should link both ledger entries to the same transaction", async () => {
    const sender = await createUser();
    const receiver = await createUser();

    const senderAccount = await createAccount(
      sender.id,
      `ACC-LEDGER-LINK-S-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );

    const receiverAccount = await createAccount(
      receiver.id,
      `ACC-LEDGER-LINK-R-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );

    await createBdtBalance(
      senderAccount.id,
      "15000",
    );

    await createBdtBalance(
      receiverAccount.id,
      "3000",
    );

    const accessToken =
      createAccessToken(sender);

    const idempotencyKey =
      createIdempotencyKey();

    const response = await request(app)
      .post("/api/v1/transfers")
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      )
      .set(
        "Idempotency-Key",
        idempotencyKey,
      )
      .send({
        senderAccount:
          senderAccount.accountNumber,
        receiverAccount:
          receiverAccount.accountNumber,
        amount: "5000",
        currency: "BDT",
      });

    expect(response.status).toBe(200);

    const transaction =
      await prisma.transaction.findFirst({
        where: {
          sourceAccountId:
            senderAccount.id,

          destinationAccountId:
            receiverAccount.id,

          type: "INTERNAL_TRANSFER",
        },
      });

    expect(transaction).not.toBeNull();

    if (!transaction) {
      throw new Error(
        "Expected transfer transaction to exist",
      );
    }

    createdTransactionIds.push(
      transaction.id,
    );

    const ledgerEntries =
      await prisma.ledgerEntry.findMany({
        where: {
          transactionId: transaction.id,
        },
      });

    expect(ledgerEntries).toHaveLength(2);

    /*
     * Every ledger entry must point to the
     * same transaction.
     */

    for (const entry of ledgerEntries) {
      expect(entry.transactionId).toBe(
        transaction.id,
      );

      expect(entry.currencyCode).toBe(
        transaction.currencyCode,
      );

      expect(entry.amount.toString()).toBe(
        transaction.amount.toString(),
      );
    }

    /*
     * Exactly one DEBIT and one CREDIT.
     */

    expect(
      ledgerEntries.filter(
        (entry) =>
          entry.entryType === "DEBIT",
      ),
    ).toHaveLength(1);

    expect(
      ledgerEntries.filter(
        (entry) =>
          entry.entryType === "CREDIT",
      ),
    ).toHaveLength(1);

    /*
     * The DEBIT must belong to sender.
     */

    const debitEntry =
      ledgerEntries.find(
        (entry) =>
          entry.entryType === "DEBIT",
      );

    expect(debitEntry?.accountId).toBe(
      senderAccount.id,
    );

    /*
     * The CREDIT must belong to receiver.
     */

    const creditEntry =
      ledgerEntries.find(
        (entry) =>
          entry.entryType === "CREDIT",
      );

    expect(creditEntry?.accountId).toBe(
      receiverAccount.id,
    );
  });
});