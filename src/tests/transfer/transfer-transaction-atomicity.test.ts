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
  // Discover every transaction related to accounts created
  // during the current test.
  //
  // This makes cleanup safer even when an assertion fails
  // before the transaction ID can be pushed into the array.
  // ----------------------------------------------------------

  if (createdAccountIds.length > 0) {
    const relatedTransactions = await prisma.transaction.findMany({
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

    // --------------------------------------------------------
    // Delete transaction legs
    // --------------------------------------------------------

    await prisma.transactionLeg.deleteMany({
      where: {
        transactionId: {
          in: createdTransactionIds,
        },
      },
    });

    // --------------------------------------------------------
    // Delete transactions
    // --------------------------------------------------------

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

    // --------------------------------------------------------
    // Delete accounts
    // --------------------------------------------------------

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
  // Clear test failure injection flag
  // ----------------------------------------------------------

  delete process.env.TRANSFER_TEST_FAILURE_AFTER_MUTATION;

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
      name: `Test User ${Date.now()}`,
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

const createAccessToken = (
  user: {
    id: string;
    email: string;
    role:
      | "CUSTOMER"
      | "ADMIN"
      | "SUPPORT"
      | "AUDITOR";
  },
) => {
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

const createIdempotencyKey = () => {
  return `transfer-atomicity-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
};

// ============================================================
// 14.6.1 Transaction Atomicity
// ============================================================

describe("14.6.1 Transaction Atomicity", () => {
  // ==========================================================
  // 14.6.1.a
  // Successful transfer commits everything
  // ==========================================================

  it("should commit the complete transfer atomically", async () => {
    // --------------------------------------------------------
    // Create users
    // --------------------------------------------------------

    const senderUser = await createUser(
      `atomicity-sender-${Date.now()}@test.com`,
    );

    const receiverUser = await createUser(
      `atomicity-receiver-${Date.now()}@test.com`,
    );

    // --------------------------------------------------------
    // Create accounts
    // --------------------------------------------------------

    const senderAccount = await createAccount(
      senderUser.id,
      `ACC-ATOMIC-S-${Date.now()}`,
    );

    const receiverAccount = await createAccount(
      receiverUser.id,
      `ACC-ATOMIC-R-${Date.now()}`,
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
    // Create authentication token
    // --------------------------------------------------------

    const accessToken = createAccessToken(senderUser);

    const idempotencyKey = createIdempotencyKey();

    // --------------------------------------------------------
    // Execute transfer
    // --------------------------------------------------------

    const response = await request(app)
      .post("/api/v1/transfers")
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", idempotencyKey)
      .send({
        senderAccount: senderAccount.accountNumber,
        receiverAccount: receiverAccount.accountNumber,
        amount: "1000",
        currency: "BDT",
      });

    expect(response.status).toBe(200);

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
      senderBalance?.availableBalance.toString(),
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
      receiverBalance?.availableBalance.toString(),
    ).toBe("6000");

    // --------------------------------------------------------
    // Verify transaction
    // --------------------------------------------------------

    const transactions =
      await prisma.transaction.findMany({
        where: {
          sourceAccountId: senderAccount.id,
          destinationAccountId: receiverAccount.id,
        },
      });

    expect(transactions).toHaveLength(1);

    const transaction = transactions[0];

    if (!transaction) {
      throw new Error(
        "Expected transfer transaction to exist",
      );
    }

    createdTransactionIds.push(transaction.id);

    expect(transaction.type).toBe(
      "INTERNAL_TRANSFER",
    );

    expect(transaction.status).toBe(
      "COMPLETED",
    );

    expect(transaction.amount.toString()).toBe(
      "1000",
    );

    expect(transaction.currencyCode).toBe(
      "BDT",
    );

    // --------------------------------------------------------
    // Verify ledger entries
    // --------------------------------------------------------

    const ledgerEntries =
      await prisma.ledgerEntry.findMany({
        where: {
          transactionId: transaction.id,
        },
      });

    expect(ledgerEntries).toHaveLength(2);

    // --------------------------------------------------------
    // Verify transaction legs
    // --------------------------------------------------------

    const transactionLegs =
      await prisma.transactionLeg.findMany({
        where: {
          transactionId: transaction.id,
        },
      });

    expect(transactionLegs).toHaveLength(2);

    // --------------------------------------------------------
    // Financial conservation
    //
    // Before:
    // Sender   = 10000
    // Receiver = 5000
    // Total    = 15000
    //
    // After:
    // Sender   = 9000
    // Receiver = 6000
    // Total    = 15000
    // --------------------------------------------------------

    const totalBalance =
      Number(
        senderBalance?.availableBalance.toString(),
      ) +
      Number(
        receiverBalance?.availableBalance.toString(),
      );

    expect(totalBalance).toBe(15000);
  });

  // ==========================================================
  // 14.6.1.b
  // Failed transfer rolls back everything
  // ==========================================================

  it("should rollback everything when transfer fails before balance mutation", async () => {
    // --------------------------------------------------------
    // Create users
    // --------------------------------------------------------

    const senderUser = await createUser(
      `atomicity-fail-sender-${Date.now()}@test.com`,
    );

    const receiverUser = await createUser(
      `atomicity-fail-receiver-${Date.now()}@test.com`,
    );

    // --------------------------------------------------------
    // Create accounts
    // --------------------------------------------------------

    const senderAccount = await createAccount(
      senderUser.id,
      `ACC-ATOMIC-FAIL-S-${Date.now()}`,
    );

    const receiverAccount = await createAccount(
      receiverUser.id,
      `ACC-ATOMIC-FAIL-R-${Date.now()}`,
    );

    // --------------------------------------------------------
    // Create balances
    // --------------------------------------------------------

    await createBdtBalance(
      senderAccount.id,
      "500",
    );

    await createBdtBalance(
      receiverAccount.id,
      "5000",
    );

    // --------------------------------------------------------
    // Create token
    // --------------------------------------------------------

    const accessToken = createAccessToken(senderUser);

    const idempotencyKey = createIdempotencyKey();

    // --------------------------------------------------------
    // Attempt transfer greater than available balance
    // --------------------------------------------------------

    const response = await request(app)
      .post("/api/v1/transfers")
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", idempotencyKey)
      .send({
        senderAccount: senderAccount.accountNumber,
        receiverAccount: receiverAccount.accountNumber,
        amount: "1000",
        currency: "BDT",
      });

    // --------------------------------------------------------
    // Transfer must fail
    // --------------------------------------------------------

    expect(response.status).not.toBe(200);

    // --------------------------------------------------------
    // Verify sender balance unchanged
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
      senderBalance?.availableBalance.toString(),
    ).toBe("500");

    // --------------------------------------------------------
    // Verify receiver balance unchanged
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
      receiverBalance?.availableBalance.toString(),
    ).toBe("5000");

    // --------------------------------------------------------
    // Verify no transaction was created
    // --------------------------------------------------------

    const transactions =
      await prisma.transaction.findMany({
        where: {
          sourceAccountId: senderAccount.id,
          destinationAccountId: receiverAccount.id,
        },
      });

    expect(transactions).toHaveLength(0);

    // --------------------------------------------------------
    // Verify no ledger entries were created
    // --------------------------------------------------------

    const ledgerEntries =
      await prisma.ledgerEntry.findMany({
        where: {
          transaction: {
            sourceAccountId: senderAccount.id,
            destinationAccountId: receiverAccount.id,
          },
        },
      });

    expect(ledgerEntries).toHaveLength(0);

    // --------------------------------------------------------
    // Verify no transaction legs were created
    // --------------------------------------------------------

    const transactionLegs =
      await prisma.transactionLeg.findMany({
        where: {
          transaction: {
            sourceAccountId: senderAccount.id,
            destinationAccountId: receiverAccount.id,
          },
        },
      });

    expect(transactionLegs).toHaveLength(0);
  });

  // ==========================================================
  // 14.6.1.c
  // Failure AFTER balance mutation must rollback
  // ==========================================================

  it("should rollback balance mutations when failure occurs after debit and credit", async () => {
    // --------------------------------------------------------
    // Create users
    // --------------------------------------------------------

    const senderUser = await createUser(
      `atomicity-mutation-sender-${Date.now()}@test.com`,
    );

    const receiverUser = await createUser(
      `atomicity-mutation-receiver-${Date.now()}@test.com`,
    );

    // --------------------------------------------------------
    // Create accounts
    // --------------------------------------------------------

    const senderAccount = await createAccount(
      senderUser.id,
      `ACC-ATOMIC-MUT-S-${Date.now()}`,
    );

    const receiverAccount = await createAccount(
      receiverUser.id,
      `ACC-ATOMIC-MUT-R-${Date.now()}`,
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
    // Create authentication token
    // --------------------------------------------------------

    const accessToken = createAccessToken(senderUser);

    const idempotencyKey = createIdempotencyKey();

    // --------------------------------------------------------
    // Save original environment values
    // --------------------------------------------------------

    const originalNodeEnv =
      process.env.NODE_ENV;

    const originalFailureFlag =
      process.env.TRANSFER_TEST_FAILURE_AFTER_MUTATION;

    try {
      // ------------------------------------------------------
      // Enable test failure injection
      // ------------------------------------------------------

      process.env.NODE_ENV = "test";

      process.env.TRANSFER_TEST_FAILURE_AFTER_MUTATION =
        "true";

      // ------------------------------------------------------
      // Execute transfer
      //
      // The service should:
      //
      // 1. Lock sender
      // 2. Lock receiver
      // 3. Debit sender
      // 4. Credit receiver
      // 5. Trigger test failure
      // 6. Rollback the entire Prisma transaction
      // ------------------------------------------------------

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

      // ------------------------------------------------------
      // Request must fail
      // ------------------------------------------------------

      expect(response.status).not.toBe(200);

      // ------------------------------------------------------
      // Verify sender balance was rolled back
      // ------------------------------------------------------

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
        senderBalance?.availableBalance.toString(),
      ).toBe("10000");

      // ------------------------------------------------------
      // Verify receiver balance was rolled back
      // ------------------------------------------------------

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
        receiverBalance?.availableBalance.toString(),
      ).toBe("5000");

      // ------------------------------------------------------
      // Verify no transaction survived
      // ------------------------------------------------------

      const transactions =
        await prisma.transaction.findMany({
          where: {
            sourceAccountId: senderAccount.id,
            destinationAccountId:
              receiverAccount.id,
          },
        });

      expect(transactions).toHaveLength(0);

      // ------------------------------------------------------
      // Verify no ledger entries survived
      // ------------------------------------------------------

      const ledgerEntries =
        await prisma.ledgerEntry.findMany({
          where: {
            transaction: {
              sourceAccountId:
                senderAccount.id,
              destinationAccountId:
                receiverAccount.id,
            },
          },
        });

      expect(ledgerEntries).toHaveLength(0);

      // ------------------------------------------------------
      // Verify no transaction legs survived
      // ------------------------------------------------------

      const transactionLegs =
        await prisma.transactionLeg.findMany({
          where: {
            transaction: {
              sourceAccountId:
                senderAccount.id,
              destinationAccountId:
                receiverAccount.id,
            },
          },
        });

      expect(transactionLegs).toHaveLength(0);

      // ------------------------------------------------------
      // Verify total balance was preserved
      //
      // Before = 10000 + 5000 = 15000
      // After  = 10000 + 5000 = 15000
      // ------------------------------------------------------

      const totalBalance =
        Number(
          senderBalance?.availableBalance.toString(),
        ) +
        Number(
          receiverBalance?.availableBalance.toString(),
        );

      expect(totalBalance).toBe(15000);
    } finally {
      // ------------------------------------------------------
      // Restore environment exactly as it was
      // ------------------------------------------------------

      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV =
          originalNodeEnv;
      }

      if (originalFailureFlag === undefined) {
        delete process.env.TRANSFER_TEST_FAILURE_AFTER_MUTATION;
      } else {
        process.env.TRANSFER_TEST_FAILURE_AFTER_MUTATION =
          originalFailureFlag;
      }
    }
  });
});