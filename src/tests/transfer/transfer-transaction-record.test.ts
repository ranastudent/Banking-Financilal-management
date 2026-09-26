import request from "supertest";

import { afterEach, describe, expect, it } from "vitest";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { generateAccessToken } from "../../auth/utils/jwt";

describe("Fund Transfer - Transaction Record", () => {
  const createdUserIds: string[] = [];
  const createdAccountIds: string[] = [];
  const createdTransactionIds: string[] = [];
  const createdIdempotencyRecordIds: string[] = [];

  afterEach(async () => {
    /*
     * Delete idempotency records created by these tests.
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
     * Delete ledger entries before transactions.
     */
    if (createdTransactionIds.length > 0) {
      await prisma.ledgerEntry.deleteMany({
        where: {
          transactionId: {
            in: createdTransactionIds,
          },
        },
      });

      /*
       * Delete transaction legs before transactions.
       */
      await prisma.transactionLeg.deleteMany({
        where: {
          transactionId: {
            in: createdTransactionIds,
          },
        },
      });

      /*
       * Delete transactions.
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
     * Delete users.
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
   * ---------------------------------------------------------
   * Helpers
   * ---------------------------------------------------------
   */

  const createUser = async () => {
    const user = await prisma.user.create({
      data: {
        name: `Transaction Record ${Date.now()}-${Math.random()}`,
        email: `transaction-record-${Date.now()}-${Math.random()}@example.com`,
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
    amount: string,
  ) => {
    return prisma.accountBalance.create({
      data: {
        accountId,
        currencyCode: "BDT",
        availableBalance: amount,
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

  const createIdempotencyKey = (prefix: string) => {
    return `${prefix}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  };

  /*
   * ---------------------------------------------------------
   * 14.10.1 Transaction record
   * ---------------------------------------------------------
   */

  it("should create exactly one completed INTERNAL_TRANSFER transaction record with the correct financial fields", async () => {
    const sender = await createUser();
    const receiver = await createUser();

    const senderAccount = await createAccount(
      sender.id,
      `ACC-TRF-S-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );

    const receiverAccount = await createAccount(
      receiver.id,
      `ACC-TRF-R-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );

    await createBdtBalance(
      senderAccount.id,
      "10000",
    );

    await createBdtBalance(
      receiverAccount.id,
      "5000",
    );

    const accessToken =
      createAccessToken(sender);

    const idempotencyKey =
      createIdempotencyKey(
        "transaction-record",
      );

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
        amount: "2500",
        currency: "BDT",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    /*
     * The API response must contain a requestId.
     */
    expect(response.body.requestId).toEqual(
      expect.any(String),
    );

    /*
     * The response transaction should contain
     * the expected transaction information.
     */
    expect(
      response.body.data.transaction.type,
    ).toBe("INTERNAL_TRANSFER");

    expect(
      response.body.data.transaction.status,
    ).toBe("COMPLETED");

    expect(
      response.body.data.transaction.amount,
    ).toBe("2500");

    expect(
      response.body.data.transaction.currencyCode,
    ).toBe("BDT");

    expect(
      response.body.data.transaction.sourceAccountId,
    ).toBe(senderAccount.id);

    expect(
      response.body.data.transaction.destinationAccountId,
    ).toBe(receiverAccount.id);

    expect(
      response.body.data.transaction.provider,
    ).toBe("INTERNAL");

    expect(
      response.body.data.transaction.reference,
    ).toMatch(/^TRF-/);

    /*
     * Find the persisted transaction.
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

    /*
     * One successful transfer must create
     * exactly one transaction record.
     */
    expect(transactions).toHaveLength(1);

    const transaction = transactions[0];

    expect(transaction).toBeDefined();

    if (!transaction) {
      throw new Error(
        "Expected transaction record to exist",
      );
    }

    createdTransactionIds.push(
      transaction.id,
    );

    /*
     * -------------------------------------------------------
     * Verify persisted transaction fields
     * -------------------------------------------------------
     */

    expect(transaction.reference).toMatch(
      /^TRF-/,
    );

    expect(transaction.type).toBe(
      "INTERNAL_TRANSFER",
    );

    expect(transaction.status).toBe(
      "COMPLETED",
    );

    expect(transaction.provider).toBe(
      "INTERNAL",
    );

    expect(transaction.amount.toString()).toBe(
      "2500",
    );

    expect(transaction.currencyCode).toBe(
      "BDT",
    );

    expect(transaction.sourceAccountId).toBe(
      senderAccount.id,
    );

    expect(
      transaction.destinationAccountId,
    ).toBe(receiverAccount.id);

    /*
     * Transaction metadata must identify the
     * internal fund-transfer operation.
     */
    expect(transaction.metadata).toEqual({
      operation: "INTERNAL_FUND_TRANSFER",
    });

    /*
     * Provider transaction ID is not required
     * for an INTERNAL provider transaction.
     */
    expect(
      transaction.providerTransactionId,
    ).toBeNull();

    /*
     * No failure information should exist on
     * a successfully completed transaction.
     */
    expect(transaction.failureCode).toBeNull();

    expect(transaction.failureReason).toBeNull();

    /*
     * A transaction reference must be unique.
     */
    const sameReferenceCount =
      await prisma.transaction.count({
        where: {
          reference: transaction.reference,
        },
      });

    expect(sameReferenceCount).toBe(1);
  });

  /*
   * ---------------------------------------------------------
   * 14.10.2 Idempotency record + transaction
   * ---------------------------------------------------------
   */

  it("should create the transaction together with its idempotency record", async () => {
    const sender = await createUser();
    const receiver = await createUser();

    const senderAccount = await createAccount(
      sender.id,
      `ACC-IDEM-S-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );

    const receiverAccount = await createAccount(
      receiver.id,
      `ACC-IDEM-R-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );

    await createBdtBalance(
      senderAccount.id,
      "10000",
    );

    await createBdtBalance(
      receiverAccount.id,
      "5000",
    );

    const accessToken =
      createAccessToken(sender);

    const idempotencyKey =
      createIdempotencyKey(
        "transaction-idempotency",
      );

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
        amount: "1500",
        currency: "BDT",
      });

    expect(response.status).toBe(200);

    /*
     * Verify the idempotency record separately.
     *
     * The current architecture stores the key
     * in IdempotencyRecord, not Transaction.
     */
    const idempotencyRecord =
      await prisma.idempotencyRecord.findUnique({
        where: {
          key_userId: {
            key: idempotencyKey,
            userId: sender.id,
          },
        },
      });

    expect(idempotencyRecord).not.toBeNull();

    if (!idempotencyRecord) {
      throw new Error(
        "Expected idempotency record to exist",
      );
    }

    createdIdempotencyRecordIds.push(
      idempotencyRecord.id,
    );

    expect(idempotencyRecord.key).toBe(
      idempotencyKey,
    );

    expect(idempotencyRecord.userId).toBe(
      sender.id,
    );

    expect(
      idempotencyRecord.responseStatus,
    ).toBe(200);

    expect(
      idempotencyRecord.responseBody,
    ).not.toBeNull();

    /*
     * Verify that exactly one financial
     * transaction was created.
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
        "Expected transaction record to exist",
      );
    }

    createdTransactionIds.push(
      transaction.id,
    );

    expect(transaction.status).toBe(
      "COMPLETED",
    );

    expect(transaction.provider).toBe(
      "INTERNAL",
    );
  });
});