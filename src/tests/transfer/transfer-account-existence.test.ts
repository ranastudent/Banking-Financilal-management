import request from "supertest";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "../../config/prisma";

import app from "../../app";

import { generateAccessToken } from "../../auth/utils/jwt";

// ============================================================
// Test State
// ============================================================

const createdUserIds: string[] = [];

const createdAccountIds: string[] = [];

const createdTransactionIds: string[] = [];

// ============================================================
// Cleanup
// ============================================================

afterEach(async () => {
  // ----------------------------------------------------------
  // Discover transactions related to test accounts.
  // ----------------------------------------------------------

  if (createdAccountIds.length > 0) {
    const relatedTransactions =
      await prisma.transaction.findMany({
        where: {
          OR: [
            {
              sourceAccountId: {
                in: createdAccountIds,
              },
            },
            {
              destinationAccountId: {
                in: createdAccountIds,
              },
            },
          ],
        },
        select: {
          id: true,
        },
      });

    for (const transaction of relatedTransactions) {
      if (!createdTransactionIds.includes(transaction.id)) {
        createdTransactionIds.push(transaction.id);
      }
    }
  }

  // ----------------------------------------------------------
  // Delete ledger entries
  // ----------------------------------------------------------

  if (createdTransactionIds.length > 0) {
    await prisma.ledgerEntry.deleteMany({
      where: {
        transactionId: {
          in: createdTransactionIds,
        },
      },
    });
  }

  // ----------------------------------------------------------
  // Delete transaction legs
  //
  // IMPORTANT:
  // transaction_legs.account_id has a foreign key to accounts.id.
  // Therefore delete by accountId as well as transactionId.
  // ----------------------------------------------------------

  if (createdAccountIds.length > 0) {
    await prisma.transactionLeg.deleteMany({
      where: {
        accountId: {
          in: createdAccountIds,
        },
      },
    });
  }

  // ----------------------------------------------------------
  // Delete transactions
  // ----------------------------------------------------------

  if (createdTransactionIds.length > 0) {
    await prisma.transaction.deleteMany({
      where: {
        id: {
          in: createdTransactionIds,
        },
      },
    });
  }

  // ----------------------------------------------------------
  // Delete account balances
  // ----------------------------------------------------------

  if (createdAccountIds.length > 0) {
    await prisma.accountBalance.deleteMany({
      where: {
        accountId: {
          in: createdAccountIds,
        },
      },
    });
  }

  // ----------------------------------------------------------
  // Delete accounts
  // ----------------------------------------------------------

  if (createdAccountIds.length > 0) {
    await prisma.account.deleteMany({
      where: {
        id: {
          in: createdAccountIds,
        },
      },
    });
  }

  // ----------------------------------------------------------
  // Delete users
  // ----------------------------------------------------------

  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({
      where: {
        id: {
          in: createdUserIds,
        },
      },
    });
  }

  // ----------------------------------------------------------
  // Reset state
  // ----------------------------------------------------------

  createdTransactionIds.length = 0;

  createdAccountIds.length = 0;

  createdUserIds.length = 0;
});

// ============================================================
// Helpers
// ============================================================

// ------------------------------------------------------------
// Create user
// ------------------------------------------------------------

const createUser = async (
  email: string,
  role:
    | "CUSTOMER"
    | "ADMIN"
    | "SUPPORT"
    | "AUDITOR" = "CUSTOMER",
) => {
  const user = await prisma.user.create({
    data: {
      name: `Test User ${Date.now()}-${Math.random()}`,
      email,
      passwordHash: "test-password-hash",
      role,
      status: "ACTIVE",
    },
  });

  createdUserIds.push(user.id);

  return user;
};

// ------------------------------------------------------------
// Create account
// ------------------------------------------------------------

const createAccount = async (
  userId: string,
  accountNumber: string,
) => {
  const account = await prisma.account.create({
    data: {
      accountNumber,
      userId,
      status: "ACTIVE",
    },
  });

  createdAccountIds.push(account.id);

  return account;
};

// ------------------------------------------------------------
// Create access token
// ------------------------------------------------------------

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

// ------------------------------------------------------------
// Create BDT balance
// ------------------------------------------------------------

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

// ------------------------------------------------------------
// Create Idempotency-Key
// ------------------------------------------------------------

const createIdempotencyKey = (prefix: string) => {
  return `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
};

// ============================================================
// 14.7.1 Account Existence Validation
// ============================================================

describe("14.7.1 Account Existence Validation", () => {
  // ==========================================================
  // 14.7.1.1
  // Sender account exists
  // ==========================================================

  it("should accept an existing sender account", async () => {
    // --------------------------------------------------------
    // Create users
    // --------------------------------------------------------

    const sender = await createUser(
      `existence-sender-${Date.now()}-${Math.random()}@test.com`,
    );

    const receiver = await createUser(
      `existence-receiver-${Date.now()}-${Math.random()}@test.com`,
    );

    // --------------------------------------------------------
    // Create accounts
    // --------------------------------------------------------

    const senderAccount = await createAccount(
      sender.id,
      `ACC-EXIST-S-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );

    const receiverAccount = await createAccount(
      receiver.id,
      `ACC-EXIST-R-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );

    // --------------------------------------------------------
    // Create balances
    // --------------------------------------------------------

    await createBdtBalance(
      senderAccount.id,
      "10000",
    );

    await createBdtBalance(
      receiverAccount.id,
      "5000",
    );

    // --------------------------------------------------------
    // Authentication
    // --------------------------------------------------------

    const accessToken = createAccessToken(sender);

    const idempotencyKey = createIdempotencyKey(
      "account-existence-sender",
    );

    // --------------------------------------------------------
    // Execute transfer
    // --------------------------------------------------------

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

    // --------------------------------------------------------
    // Existing sender account must resolve successfully
    // --------------------------------------------------------

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    // --------------------------------------------------------
    // Verify transaction
    // --------------------------------------------------------

    expect(
      response.body.data.transaction.type,
    ).toBe("INTERNAL_TRANSFER");

    expect(
      response.body.data.transaction.status,
    ).toBe("COMPLETED");

    
    // --------------------------------------------------------
    // Verify transaction in database
    // --------------------------------------------------------

    const transaction =
      await prisma.transaction.findFirst({
        where: {
          sourceAccountId:
            senderAccount.id,

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
      createdTransactionIds.push(transaction.id);
    }
  });

  // ==========================================================
  // 14.7.1.2
  // Sender account does not exist
  // ==========================================================

  it("should reject a non-existent sender account", async () => {
    // --------------------------------------------------------
    // Create receiver user/account
    // --------------------------------------------------------

    const sender = await createUser(
      `existence-invalid-sender-${Date.now()}-${Math.random()}@test.com`,
    );

    const receiver = await createUser(
      `existence-invalid-sender-receiver-${Date.now()}-${Math.random()}@test.com`,
    );

    const receiverAccount = await createAccount(
      receiver.id,
      `ACC-EXIST-INVALID-S-R-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );

    await createBdtBalance(
      receiverAccount.id,
      "5000",
    );

    // --------------------------------------------------------
    // Authentication
    // --------------------------------------------------------

    const accessToken = createAccessToken(sender);

    const idempotencyKey = createIdempotencyKey(
      "invalid-sender-account",
    );

    const invalidSenderAccount =
      `ACC-NOT-EXIST-SENDER-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

    // --------------------------------------------------------
    // Capture receiver balance before request
    // --------------------------------------------------------

    const beforeReceiver =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId: receiverAccount.id,
            currencyCode: "BDT",
          },
        },
      });

    expect(beforeReceiver).not.toBeNull();

    expect(
      beforeReceiver!.availableBalance.toString(),
    ).toBe("5000");

    // --------------------------------------------------------
    // Count existing transactions
    // --------------------------------------------------------

    const transactionsBefore =
      await prisma.transaction.count({
        where: {
          destinationAccountId:
            receiverAccount.id,
        },
      });

    // --------------------------------------------------------
    // Execute transfer
    // --------------------------------------------------------

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
          invalidSenderAccount,

        receiverAccount:
          receiverAccount.accountNumber,

        amount: "1000",

        currency: "BDT",
      });

    // --------------------------------------------------------
    // Sender must be rejected
    // --------------------------------------------------------

    expect(response.status).toBe(404);

    expect(response.body.success).toBe(false);

    expect(response.body.error.code).toBe(
      "RESOURCE_NOT_FOUND",
    );

    expect(response.body.error.message).toBe(
      "Account not found",
    );

    // --------------------------------------------------------
    // Receiver balance must remain unchanged
    // --------------------------------------------------------

    const afterReceiver =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId: receiverAccount.id,
            currencyCode: "BDT",
          },
        },
      });

    expect(afterReceiver).not.toBeNull();

    expect(
      afterReceiver!.availableBalance.toString(),
    ).toBe("5000");

    // --------------------------------------------------------
    // No transaction may be created
    // --------------------------------------------------------

    const transactionsAfter =
      await prisma.transaction.count({
        where: {
          destinationAccountId:
            receiverAccount.id,
        },
      });

    expect(transactionsAfter).toBe(
      transactionsBefore,
    );
  });

  // ==========================================================
  // 14.7.1.3
  // Receiver account does not exist
  // ==========================================================

  it("should reject a non-existent receiver account", async () => {
    // --------------------------------------------------------
    // Create users
    // --------------------------------------------------------

    const sender = await createUser(
      `existence-invalid-receiver-sender-${Date.now()}-${Math.random()}@test.com`,
    );

    const receiver = await createUser(
      `existence-invalid-receiver-${Date.now()}-${Math.random()}@test.com`,
    );

    // --------------------------------------------------------
    // Create sender account
    // --------------------------------------------------------

    const senderAccount = await createAccount(
      sender.id,
      `ACC-EXIST-INVALID-R-S-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );

    await createBdtBalance(
      senderAccount.id,
      "10000",
    );

    // --------------------------------------------------------
    // Authentication
    // --------------------------------------------------------

    const accessToken = createAccessToken(sender);

    const idempotencyKey = createIdempotencyKey(
      "invalid-receiver-account",
    );

    const invalidReceiverAccount =
      `ACC-NOT-EXIST-RECEIVER-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

    // --------------------------------------------------------
    // Capture sender balance before request
    // --------------------------------------------------------

    const beforeSender =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId: senderAccount.id,
            currencyCode: "BDT",
          },
        },
      });

    expect(beforeSender).not.toBeNull();

    expect(
      beforeSender!.availableBalance.toString(),
    ).toBe("10000");

    // --------------------------------------------------------
    // Count existing transactions
    // --------------------------------------------------------

    const transactionsBefore =
      await prisma.transaction.count({
        where: {
          sourceAccountId:
            senderAccount.id,
        },
      });

    // --------------------------------------------------------
    // Execute transfer
    // --------------------------------------------------------

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
          invalidReceiverAccount,

        amount: "1000",

        currency: "BDT",
      });

    // --------------------------------------------------------
    // Receiver must be rejected
    // --------------------------------------------------------

    expect(response.status).toBe(404);

    expect(response.body.success).toBe(false);

    expect(response.body.error.code).toBe(
      "RESOURCE_NOT_FOUND",
    );

    expect(response.body.error.message).toBe(
      "Account not found",
    );

    // --------------------------------------------------------
    // Sender balance must remain unchanged
    // --------------------------------------------------------

    const afterSender =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId: senderAccount.id,
            currencyCode: "BDT",
          },
        },
      });

    expect(afterSender).not.toBeNull();

    expect(
      afterSender!.availableBalance.toString(),
    ).toBe("10000");

    // --------------------------------------------------------
    // No transaction may be created
    // --------------------------------------------------------

    const transactionsAfter =
      await prisma.transaction.count({
        where: {
          sourceAccountId:
            senderAccount.id,
        },
      });

    expect(transactionsAfter).toBe(
      transactionsBefore,
    );

    // --------------------------------------------------------
    // Invalid receiver must not resolve
    // --------------------------------------------------------

    const resolvedReceiver =
      await prisma.account.findUnique({
        where: {
          accountNumber:
            invalidReceiverAccount,
        },
        select: {
          id: true,
        },
      });

    expect(resolvedReceiver).toBeNull();
  });
});