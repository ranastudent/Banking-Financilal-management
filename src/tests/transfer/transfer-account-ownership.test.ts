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
// 14.7.3 Account Ownership Validation
// ============================================================

describe("14.7.3 Account Ownership Validation", () => {
  // ==========================================================
  // 14.7.3.1
  // CUSTOMER owns sender
  // ==========================================================

  it("should allow a CUSTOMER to use their own sender account", async () => {
    // --------------------------------------------------------
    // Create users
    // --------------------------------------------------------

    const sender = await createUser(
      `ownership-own-sender-${Date.now()}-${Math.random()}@test.com`,
    );

    const receiver = await createUser(
      `ownership-own-sender-receiver-${Date.now()}-${Math.random()}@test.com`,
    );

    // --------------------------------------------------------
    // Create accounts
    // --------------------------------------------------------

    const senderAccount = await createAccount(
      sender.id,
      `ACC-OWN-S-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );

    const receiverAccount = await createAccount(
      receiver.id,
      `ACC-OWN-S-R-${Date.now()}-${Math.random()
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
    // Verify database ownership
    // --------------------------------------------------------

    expect(senderAccount.userId).toBe(
      sender.id,
    );

    // --------------------------------------------------------
    // Authentication
    // --------------------------------------------------------

    const accessToken =
      createAccessToken(sender);

    const idempotencyKey =
      createIdempotencyKey(
        "customer-own-sender",
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
    // Own sender account must be accepted
    // --------------------------------------------------------

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(
      response.body.data.transaction.type,
    ).toBe("INTERNAL_TRANSFER");

    expect(
      response.body.data.transaction.status,
    ).toBe("COMPLETED");

    // --------------------------------------------------------
    // Verify transaction account ownership
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
      createdTransactionIds.push(
        transaction.id,
      );
    }
  });

  // ==========================================================
  // 14.7.3.2
  // CUSTOMER cannot use another customer's sender
  // ==========================================================

  it("should reject a CUSTOMER using another customer's sender account", async () => {
    // --------------------------------------------------------
    // Create users
    // --------------------------------------------------------

    const customerA = await createUser(
      `ownership-customer-a-${Date.now()}-${Math.random()}@test.com`,
    );

    const customerB = await createUser(
      `ownership-customer-b-${Date.now()}-${Math.random()}@test.com`,
    );

    // --------------------------------------------------------
    // Create accounts
    // --------------------------------------------------------

    const customerAAccount =
      await createAccount(
        customerA.id,
        `ACC-OWN-A-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
      );

    const customerBAccount =
      await createAccount(
        customerB.id,
        `ACC-OWN-B-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
      );

    // --------------------------------------------------------
    // Create balances
    // --------------------------------------------------------

    await createBdtBalance(
      customerAAccount.id,
      "5000",
    );

    await createBdtBalance(
      customerBAccount.id,
      "10000",
    );

    // --------------------------------------------------------
    // Verify ownership relationship
    // --------------------------------------------------------

    expect(customerBAccount.userId).toBe(
      customerB.id,
    );

    expect(customerBAccount.userId).not.toBe(
      customerA.id,
    );

    // --------------------------------------------------------
    // Capture balances before request
    // --------------------------------------------------------

    const beforeA =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId:
              customerAAccount.id,
            currencyCode: "BDT",
          },
        },
      });

    const beforeB =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId:
              customerBAccount.id,
            currencyCode: "BDT",
          },
        },
      });

    expect(beforeA).not.toBeNull();

    expect(beforeB).not.toBeNull();

    expect(
      beforeA!.availableBalance.toString(),
    ).toBe("5000");

    expect(
      beforeB!.availableBalance.toString(),
    ).toBe("10000");

    // --------------------------------------------------------
    // Count transactions before request
    // --------------------------------------------------------

    const transactionsBefore =
      await prisma.transaction.count({
        where: {
          OR: [
            {
              sourceAccountId:
                customerBAccount.id,
            },
            {
              destinationAccountId:
                customerAAccount.id,
            },
          ],
        },
      });

    // --------------------------------------------------------
    // Authenticate as Customer A
    // --------------------------------------------------------

    const accessToken =
      createAccessToken(customerA);

    const idempotencyKey =
      createIdempotencyKey(
        "foreign-sender-ownership",
      );

    // --------------------------------------------------------
    // Customer A attempts to use Customer B's
    // account as sender
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
          customerBAccount.accountNumber,

        receiverAccount:
          customerAAccount.accountNumber,

        amount: "1000",

        currency: "BDT",
      });

    // --------------------------------------------------------
    // Ownership violation must be rejected
    // --------------------------------------------------------

    expect(response.status).toBe(403);

    expect(response.body.success).toBe(false);

    expect(response.body.error.code).toBe(
      "FORBIDDEN",
    );

    // --------------------------------------------------------
    // Customer A balance unchanged
    // --------------------------------------------------------

    const afterA =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId:
              customerAAccount.id,
            currencyCode: "BDT",
          },
        },
      });

    expect(afterA).not.toBeNull();

    expect(
      afterA!.availableBalance.toString(),
    ).toBe("5000");

    // --------------------------------------------------------
    // Customer B balance unchanged
    // --------------------------------------------------------

    const afterB =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId:
              customerBAccount.id,
            currencyCode: "BDT",
          },
        },
      });

    expect(afterB).not.toBeNull();

    expect(
      afterB!.availableBalance.toString(),
    ).toBe("10000");

    // --------------------------------------------------------
    // No transaction may be created
    // --------------------------------------------------------

    const transactionsAfter =
      await prisma.transaction.count({
        where: {
          OR: [
            {
              sourceAccountId:
                customerBAccount.id,
            },
            {
              destinationAccountId:
                customerAAccount.id,
            },
          ],
        },
      });

    expect(transactionsAfter).toBe(
      transactionsBefore,
    );
  });

  // ==========================================================
  // 14.7.3.3
  // Receiver ownership is not required
  // ==========================================================

  it("should allow a CUSTOMER to transfer to another customer's receiver account", async () => {
    // --------------------------------------------------------
    // Create users
    // --------------------------------------------------------

    const sender = await createUser(
      `ownership-receiver-sender-${Date.now()}-${Math.random()}@test.com`,
    );

    const receiver = await createUser(
      `ownership-receiver-owner-${Date.now()}-${Math.random()}@test.com`,
    );

    // --------------------------------------------------------
    // Create accounts
    // --------------------------------------------------------

    const senderAccount = await createAccount(
      sender.id,
      `ACC-OWN-RECEIVER-S-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );

    const receiverAccount = await createAccount(
      receiver.id,
      `ACC-OWN-RECEIVER-R-${Date.now()}-${Math.random()
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
    // Verify receiver belongs to another customer
    // --------------------------------------------------------

    expect(receiverAccount.userId).toBe(
      receiver.id,
    );

    expect(receiverAccount.userId).not.toBe(
      sender.id,
    );

    // --------------------------------------------------------
    // Authentication
    // --------------------------------------------------------

    const accessToken =
      createAccessToken(sender);

    const idempotencyKey =
      createIdempotencyKey(
        "receiver-ownership-not-required",
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
    // Receiver ownership must not be required
    // --------------------------------------------------------

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(
      response.body.data.transaction.type,
    ).toBe("INTERNAL_TRANSFER");

    expect(
      response.body.data.transaction.status,
    ).toBe("COMPLETED");

    // --------------------------------------------------------
    // Verify transaction
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

    expect(
      transaction?.sourceAccountId,
    ).toBe(senderAccount.id);

    expect(
      transaction?.destinationAccountId,
    ).toBe(receiverAccount.id);

    if (transaction) {
      createdTransactionIds.push(
        transaction.id,
      );
    }

    // --------------------------------------------------------
    // Verify sender balance
    // --------------------------------------------------------

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

    // --------------------------------------------------------
    // Verify receiver balance
    // --------------------------------------------------------

    const receiverBalance =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId: receiverAccount.id,
            currencyCode: "BDT",
          },
        },
      });

    expect(receiverBalance).not.toBeNull();

    expect(
      receiverBalance!.availableBalance.toString(),
    ).toBe("6000");
  });
});