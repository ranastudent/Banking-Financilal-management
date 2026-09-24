import request from "supertest";

import { afterEach, describe, expect, it } from "vitest";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { generateAccessToken } from "../../auth/utils/jwt";

describe("Fund Transfer - Idempotency", () => {
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

      createdIdempotencyRecordIds.length = 0;
    }

    /*
     * Delete ledger entries and transaction legs
     * before deleting transactions.
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

      createdTransactionIds.length = 0;
    }

    /*
     * Delete balances before accounts.
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

      createdAccountIds.length = 0;
    }

    /*
     * Delete user-dependent records before users.
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

      await prisma.user.deleteMany({
        where: {
          id: {
            in: createdUserIds,
          },
        },
      });

      createdUserIds.length = 0;
    }
  });

  /*
   * ---------------------------------------------------------
   * Test helpers
   * ---------------------------------------------------------
   */

  const createUser = async () => {
    const user = await prisma.user.create({
      data: {
        name: `Transfer Idempotency ${Date.now()}-${Math.random()}`,
        email: `transfer-idempotency-${Date.now()}-${Math.random()}@example.com`,
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
        accountNumber: `ACC-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
        accountType: "SAVINGS",
        status: "ACTIVE",
      },
    });

    createdAccountIds.push(account.id);

    return account;
  };

  /*
   * Support all application roles so the helper is compatible
   * with Prisma's UserRole type.
   */
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

  /*
   * ---------------------------------------------------------
   * 14.5.2 First request creates transfer
   * ---------------------------------------------------------
   */
  it("should execute the first request successfully", async () => {
    const sender = await createUser();
    const receiver = await createUser();

    const senderAccount = await createAccount(sender.id);
    const receiverAccount = await createAccount(receiver.id);

    await createBdtBalance(
      senderAccount.id,
      "10000",
    );

    await createBdtBalance(
      receiverAccount.id,
      "5000",
    );

    const accessToken = createAccessToken(sender);

    const idempotencyKey =
      createIdempotencyKey("transfer-first");

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
        amount: "1000",
        currency: "BDT",
      });

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(
      response.body.data.transaction.type,
    ).toBe("INTERNAL_TRANSFER");

    expect(
      response.body.data.transaction.status,
    ).toBe("COMPLETED");

    expect(
      response.body.data.transaction.amount,
    ).toBe("1000");

    const transaction =
      await prisma.transaction.findFirst({
        where: {
          sourceAccountId: senderAccount.id,
          destinationAccountId:
            receiverAccount.id,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

    expect(transaction).not.toBeNull();

    if (transaction) {
      createdTransactionIds.push(
        transaction.id,
      );
    }
  });

  /*
   * ---------------------------------------------------------
   * 14.5.3 Same key + same request replays response
   * ---------------------------------------------------------
   */
  it("should replay the same response when the same key and request are sent again", async () => {
    const sender = await createUser();
    const receiver = await createUser();

    const senderAccount = await createAccount(sender.id);
    const receiverAccount = await createAccount(receiver.id);

    await createBdtBalance(
      senderAccount.id,
      "10000",
    );

    await createBdtBalance(
      receiverAccount.id,
      "5000",
    );

    const accessToken = createAccessToken(sender);

    const idempotencyKey =
      createIdempotencyKey("transfer-replay");

    const payload = {
      senderAccount:
        senderAccount.accountNumber,
      receiverAccount:
        receiverAccount.accountNumber,
      amount: "1000",
      currency: "BDT",
    };

    const firstResponse = await request(app)
      .post("/api/v1/transfers")
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      )
      .set(
        "Idempotency-Key",
        idempotencyKey,
      )
      .send(payload);

    expect(firstResponse.status).toBe(200);

    const secondResponse = await request(app)
      .post("/api/v1/transfers")
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      )
      .set(
        "Idempotency-Key",
        idempotencyKey,
      )
      .send(payload);

    expect(secondResponse.status).toBe(200);

    expect(secondResponse.body.success).toBe(
      true,
    );

    /*
     * The logical response should be replayed.
     */
    expect(
      secondResponse.body.data,
    ).toEqual(firstResponse.body.data);

    /*
     * requestId is generated per HTTP request,
     * therefore it should not be expected to match.
     */
    expect(
      secondResponse.body.requestId,
    ).toEqual(expect.any(String));

    /*
     * Register the actual transaction for cleanup.
     */
    const transaction =
      await prisma.transaction.findFirst({
        where: {
          sourceAccountId: senderAccount.id,
          destinationAccountId:
            receiverAccount.id,
          type: "INTERNAL_TRANSFER",
        },
        orderBy: {
          createdAt: "desc",
        },
      });

    expect(transaction).not.toBeNull();

    if (transaction) {
      createdTransactionIds.push(
        transaction.id,
      );
    }
  });

  /*
   * ---------------------------------------------------------
   * 14.5.4 Same key must not duplicate
   * financial changes
   * ---------------------------------------------------------
   */
  it("should not duplicate the financial effect when the same key is reused", async () => {
    const sender = await createUser();
    const receiver = await createUser();

    const senderAccount = await createAccount(sender.id);
    const receiverAccount = await createAccount(receiver.id);

    await createBdtBalance(
      senderAccount.id,
      "10000",
    );

    await createBdtBalance(
      receiverAccount.id,
      "5000",
    );

    const accessToken = createAccessToken(sender);

    const idempotencyKey =
      createIdempotencyKey("transfer-integrity");

    const payload = {
      senderAccount:
        senderAccount.accountNumber,
      receiverAccount:
        receiverAccount.accountNumber,
      amount: "1000",
      currency: "BDT",
    };

    const beforeSender =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId: senderAccount.id,
            currencyCode: "BDT",
          },
        },
      });

    const beforeReceiver =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId: receiverAccount.id,
            currencyCode: "BDT",
          },
        },
      });

    expect(beforeSender).not.toBeNull();
    expect(beforeReceiver).not.toBeNull();

    const firstResponse = await request(app)
      .post("/api/v1/transfers")
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      )
      .set(
        "Idempotency-Key",
        idempotencyKey,
      )
      .send(payload);

    expect(firstResponse.status).toBe(200);

    const secondResponse = await request(app)
      .post("/api/v1/transfers")
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      )
      .set(
        "Idempotency-Key",
        idempotencyKey,
      )
      .send(payload);

    expect(secondResponse.status).toBe(200);

    const afterSender =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId: senderAccount.id,
            currencyCode: "BDT",
          },
        },
      });

    const afterReceiver =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId: receiverAccount.id,
            currencyCode: "BDT",
          },
        },
      });

    expect(afterSender).not.toBeNull();
    expect(afterReceiver).not.toBeNull();

    expect(
      afterSender!.availableBalance.toString(),
    ).toBe("9000");

    expect(
      afterReceiver!.availableBalance.toString(),
    ).toBe("6000");

    /*
     * The transfer must exist only once.
     */
    const transactions =
      await prisma.transaction.findMany({
        where: {
          sourceAccountId: senderAccount.id,
          destinationAccountId:
            receiverAccount.id,
          type: "INTERNAL_TRANSFER",
        },
      });

    expect(transactions).toHaveLength(1);

    const transaction = transactions[0];

    /*
     * TypeScript-safe narrowing.
     */
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
     * One transfer creates exactly two ledger
     * entries: one DEBIT and one CREDIT.
     */
    const ledgerEntries =
      await prisma.ledgerEntry.count({
        where: {
          transactionId: transaction.id,
        },
      });

    expect(ledgerEntries).toBe(2);
  });

  /*
   * ---------------------------------------------------------
   * 14.5.5 Same key + different request rejected
   * ---------------------------------------------------------
   */
  it("should reject the same idempotency key when the request payload changes", async () => {
    const sender = await createUser();
    const receiver = await createUser();

    const senderAccount = await createAccount(sender.id);
    const receiverAccount = await createAccount(receiver.id);

    await createBdtBalance(
      senderAccount.id,
      "10000",
    );

    await createBdtBalance(
      receiverAccount.id,
      "5000",
    );

    const accessToken = createAccessToken(sender);

    const idempotencyKey =
      createIdempotencyKey("transfer-conflict");

    const firstPayload = {
      senderAccount:
        senderAccount.accountNumber,
      receiverAccount:
        receiverAccount.accountNumber,
      amount: "1000",
      currency: "BDT",
    };

    const secondPayload = {
      senderAccount:
        senderAccount.accountNumber,
      receiverAccount:
        receiverAccount.accountNumber,
      amount: "2000",
      currency: "BDT",
    };

    const firstResponse = await request(app)
      .post("/api/v1/transfers")
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      )
      .set(
        "Idempotency-Key",
        idempotencyKey,
      )
      .send(firstPayload);

    expect(firstResponse.status).toBe(200);

    const secondResponse = await request(app)
      .post("/api/v1/transfers")
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      )
      .set(
        "Idempotency-Key",
        idempotencyKey,
      )
      .send(secondPayload);

    expect(secondResponse.status).toBe(409);

    expect(secondResponse.body.success).toBe(
      false,
    );

    expect(
      secondResponse.body.error.code,
    ).toBe("CONFLICT");

    expect(
      secondResponse.body.error.message,
    ).toBe(
      "Idempotency-Key was already used with a different request",
    );

    /*
     * Only the first request should affect
     * the sender balance.
     */
    const senderBalance =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId: senderAccount.id,
            currencyCode: "BDT",
          },
        },
      });

    expect(senderBalance).not.toBeNull();

    expect(
      senderBalance!.availableBalance.toString(),
    ).toBe("9000");

    const transactions =
      await prisma.transaction.findMany({
        where: {
          sourceAccountId: senderAccount.id,
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
  });

  /*
   * ---------------------------------------------------------
   * 14.5.6 Concurrent duplicate requests
   * ---------------------------------------------------------
   */
  it("should prevent concurrent duplicate transfers with the same idempotency key", async () => {
    const sender = await createUser();
    const receiver = await createUser();

    const senderAccount = await createAccount(sender.id);
    const receiverAccount = await createAccount(receiver.id);

    await createBdtBalance(
      senderAccount.id,
      "10000",
    );

    await createBdtBalance(
      receiverAccount.id,
      "5000",
    );

    const accessToken = createAccessToken(sender);

    const idempotencyKey =
      createIdempotencyKey("transfer-concurrent");

    const payload = {
      senderAccount:
        senderAccount.accountNumber,
      receiverAccount:
        receiverAccount.accountNumber,
      amount: "1000",
      currency: "BDT",
    };

    const [
      firstResponse,
      secondResponse,
    ] = await Promise.all([
      request(app)
        .post("/api/v1/transfers")
        .set(
          "Authorization",
          `Bearer ${accessToken}`,
        )
        .set(
          "Idempotency-Key",
          idempotencyKey,
        )
        .send(payload),

      request(app)
        .post("/api/v1/transfers")
        .set(
          "Authorization",
          `Bearer ${accessToken}`,
        )
        .set(
          "Idempotency-Key",
          idempotencyKey,
        )
        .send(payload),
    ]);

    const statuses = [
      firstResponse.status,
      secondResponse.status,
    ].sort();

    /*
     * One request must execute successfully.
     */
    expect(statuses).toEqual(
      expect.arrayContaining([200]),
    );

    /*
     * The second concurrent request may either:
     *
     * 1. receive the completed replay, or
     * 2. receive 409 while the first request
     *    is still processing.
     */
    expect(
      statuses.every(
        (status) =>
          status === 200 || status === 409,
      ),
    ).toBe(true);

    const senderBalance =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId: senderAccount.id,
            currencyCode: "BDT",
          },
        },
      });

    const receiverBalance =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId: receiverAccount.id,
            currencyCode: "BDT",
          },
        },
      });

    expect(senderBalance).not.toBeNull();
    expect(receiverBalance).not.toBeNull();

    expect(
      senderBalance!.availableBalance.toString(),
    ).toBe("9000");

    expect(
      receiverBalance!.availableBalance.toString(),
    ).toBe("6000");

    /*
     * Most important assertion:
     * exactly ONE financial transaction.
     */
    const transactions =
      await prisma.transaction.findMany({
        where: {
          sourceAccountId: senderAccount.id,
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
  });
});