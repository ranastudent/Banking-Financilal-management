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
// 14.7.2 Account State Validation
// ============================================================

describe("14.7.2 Account State Validation", () => {
  // ==========================================================
  // 14.7.2.1
  // FROZEN sender rejected
  // ==========================================================

  it("should reject a transfer when the sender account is FROZEN", async () => {
    // --------------------------------------------------------
    // Create users
    // --------------------------------------------------------

    const sender = await createUser(
      `state-frozen-sender-${Date.now()}-${Math.random()}@test.com`,
    );

    const receiver = await createUser(
      `state-frozen-sender-receiver-${Date.now()}-${Math.random()}@test.com`,
    );

    // --------------------------------------------------------
    // Create accounts
    // --------------------------------------------------------

    const senderAccount = await createAccount(
      sender.id,
      `ACC-STATE-FROZEN-S-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );

    const receiverAccount = await createAccount(
      receiver.id,
      `ACC-STATE-FROZEN-S-R-${Date.now()}-${Math.random()
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
    // Freeze sender account
    // --------------------------------------------------------

    await prisma.account.update({
      where: {
        id: senderAccount.id,
      },
      data: {
        status: "FROZEN",
      },
    });

    // --------------------------------------------------------
    // Capture balances before request
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

    expect(
      beforeSender!.availableBalance.toString(),
    ).toBe("10000");

    expect(
      beforeReceiver!.availableBalance.toString(),
    ).toBe("5000");

    // --------------------------------------------------------
    // Count transactions before request
    // --------------------------------------------------------

    const transactionsBefore =
      await prisma.transaction.count({
        where: {
          OR: [
            {
              sourceAccountId:
                senderAccount.id,
            },
            {
              destinationAccountId:
                receiverAccount.id,
            },
          ],
        },
      });

    // --------------------------------------------------------
    // Authentication
    // --------------------------------------------------------

    const accessToken =
      createAccessToken(sender);

    const idempotencyKey =
      createIdempotencyKey(
        "frozen-sender",
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
    // Sender must be rejected
    // --------------------------------------------------------

    expect(response.status).toBe(409);

    expect(response.body.success).toBe(false);

    // --------------------------------------------------------
    // Account state error
    // --------------------------------------------------------

    expect(
      response.body.error.message,
    ).toContain("active");

    // --------------------------------------------------------
    // Verify sender balance unchanged
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
    // Verify receiver balance unchanged
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
          OR: [
            {
              sourceAccountId:
                senderAccount.id,
            },
            {
              destinationAccountId:
                receiverAccount.id,
            },
          ],
        },
      });

    expect(transactionsAfter).toBe(
      transactionsBefore,
    );
  });

  // ==========================================================
  // 14.7.2.2
  // FROZEN receiver rejected
  // ==========================================================

  it("should reject a transfer when the receiver account is FROZEN", async () => {
    // --------------------------------------------------------
    // Create users
    // --------------------------------------------------------

    const sender = await createUser(
      `state-frozen-receiver-sender-${Date.now()}-${Math.random()}@test.com`,
    );

    const receiver = await createUser(
      `state-frozen-receiver-${Date.now()}-${Math.random()}@test.com`,
    );

    // --------------------------------------------------------
    // Create accounts
    // --------------------------------------------------------

    const senderAccount = await createAccount(
      sender.id,
      `ACC-STATE-FROZEN-R-S-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );

    const receiverAccount = await createAccount(
      receiver.id,
      `ACC-STATE-FROZEN-R-R-${Date.now()}-${Math.random()
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
    // Freeze receiver account
    // --------------------------------------------------------

    await prisma.account.update({
      where: {
        id: receiverAccount.id,
      },
      data: {
        status: "FROZEN",
      },
    });

    // --------------------------------------------------------
    // Capture balances before request
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

    expect(
      beforeSender!.availableBalance.toString(),
    ).toBe("10000");

    expect(
      beforeReceiver!.availableBalance.toString(),
    ).toBe("5000");

    // --------------------------------------------------------
    // Count transactions before request
    // --------------------------------------------------------

    const transactionsBefore =
      await prisma.transaction.count({
        where: {
          OR: [
            {
              sourceAccountId:
                senderAccount.id,
            },
            {
              destinationAccountId:
                receiverAccount.id,
            },
          ],
        },
      });

    // --------------------------------------------------------
    // Authentication
    // --------------------------------------------------------

    const accessToken =
      createAccessToken(sender);

    const idempotencyKey =
      createIdempotencyKey(
        "frozen-receiver",
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
    // Receiver must be rejected
    // --------------------------------------------------------

    expect(response.status).toBe(409);

    expect(response.body.success).toBe(false);

    expect(
      response.body.error.message,
    ).toContain("active");

    // --------------------------------------------------------
    // Verify sender balance unchanged
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
    // Verify receiver balance unchanged
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
          OR: [
            {
              sourceAccountId:
                senderAccount.id,
            },
            {
              destinationAccountId:
                receiverAccount.id,
            },
          ],
        },
      });

    expect(transactionsAfter).toBe(
      transactionsBefore,
    );
  });

  // ==========================================================
  // 14.7.2.3
  // CLOSED account rejected
  // ==========================================================

  it("should reject a transfer when an account is CLOSED", async () => {
    // --------------------------------------------------------
    // Create users
    // --------------------------------------------------------

    const sender = await createUser(
      `state-closed-sender-${Date.now()}-${Math.random()}@test.com`,
    );

    const receiver = await createUser(
      `state-closed-receiver-${Date.now()}-${Math.random()}@test.com`,
    );

    // --------------------------------------------------------
    // Create accounts
    // --------------------------------------------------------

    const senderAccount = await createAccount(
      sender.id,
      `ACC-STATE-CLOSED-S-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );

    const receiverAccount = await createAccount(
      receiver.id,
      `ACC-STATE-CLOSED-R-${Date.now()}-${Math.random()
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
    // Close sender account
    // --------------------------------------------------------

    await prisma.account.update({
      where: {
        id: senderAccount.id,
      },
      data: {
        status: "CLOSED",
      },
    });

    // --------------------------------------------------------
    // Capture balances before request
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

    expect(
      beforeSender!.availableBalance.toString(),
    ).toBe("10000");

    expect(
      beforeReceiver!.availableBalance.toString(),
    ).toBe("5000");

    // --------------------------------------------------------
    // Count transactions before request
    // --------------------------------------------------------

    const transactionsBefore =
      await prisma.transaction.count({
        where: {
          OR: [
            {
              sourceAccountId:
                senderAccount.id,
            },
            {
              destinationAccountId:
                receiverAccount.id,
            },
          ],
        },
      });

    // --------------------------------------------------------
    // Authentication
    // --------------------------------------------------------

    const accessToken =
      createAccessToken(sender);

    const idempotencyKey =
      createIdempotencyKey(
        "closed-account",
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
    // Closed account must be rejected
    // --------------------------------------------------------

    expect(response.status).toBe(409);

    expect(response.body.success).toBe(false);

    expect(
      response.body.error.message,
    ).toContain("active");

    // --------------------------------------------------------
    // Verify sender balance unchanged
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
    // Verify receiver balance unchanged
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
          OR: [
            {
              sourceAccountId:
                senderAccount.id,
            },
            {
              destinationAccountId:
                receiverAccount.id,
            },
          ],
        },
      });

    expect(transactionsAfter).toBe(
      transactionsBefore,
    );
  });
});