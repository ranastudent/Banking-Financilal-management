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
  // Discover transactions related to test accounts
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
  // Delete balances
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
  // Clear test failure injection
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
      accountType: "SAVINGS",
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
// Idempotency key
// ------------------------------------------------------------

const createIdempotencyKey = (prefix: string) => {
  return `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
};

// ============================================================
// 14.9 Atomic Debit + Credit
// ============================================================

describe("14.9 Atomic Debit + Credit", () => {
  // ==========================================================
  // 14.9.1
  // Successful debit + credit
  // ==========================================================

  it(
    "should atomically debit the sender and credit the receiver",
    async () => {
      // ------------------------------------------------------
      // Create users
      // ------------------------------------------------------

      const sender = await createUser(
        `atomic-debit-credit-sender-${Date.now()}-${Math.random()}@test.com`,
      );

      const receiver = await createUser(
        `atomic-debit-credit-receiver-${Date.now()}-${Math.random()}@test.com`,
      );

      // ------------------------------------------------------
      // Create accounts
      // ------------------------------------------------------

      const senderAccount = await createAccount(
        sender.id,
        `ACC-ATOMIC-DC-S-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
      );

      const receiverAccount = await createAccount(
        receiver.id,
        `ACC-ATOMIC-DC-R-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
      );

      // ------------------------------------------------------
      // Initial balances
      //
      // Sender   = 10,000
      // Receiver = 2,000
      // Transfer = 5,000
      // ------------------------------------------------------

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

      const response = await request(app)
        .post("/api/v1/transfers")
        .set(
          "Authorization",
          `Bearer ${accessToken}`,
        )
        .set(
          "Idempotency-Key",
          createIdempotencyKey(
            "atomic-debit-credit-success",
          ),
        )
        .send({
          senderAccount:
            senderAccount.accountNumber,

          receiverAccount:
            receiverAccount.accountNumber,

          amount: "5000",

          currency: "BDT",
        });

      // ------------------------------------------------------
      // Transfer must succeed
      // ------------------------------------------------------

      expect(response.status).toBe(200);

      expect(response.body.success).toBe(true);

      expect(
        response.body.data.transaction.status,
      ).toBe("COMPLETED");

      // ------------------------------------------------------
      // Verify sender
      //
      // 10,000 → 5,000
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
        senderBalance!.availableBalance.toString(),
      ).toBe("5000");

      // ------------------------------------------------------
      // Verify receiver
      //
      // 2,000 → 7,000
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
        receiverBalance!.availableBalance.toString(),
      ).toBe("7000");

      // ------------------------------------------------------
      // Financial conservation
      //
      // Before = 10,000 + 2,000 = 12,000
      // After  =  5,000 + 7,000 = 12,000
      // ------------------------------------------------------

      const totalBalance =
        Number(
          senderBalance!.availableBalance.toString(),
        ) +
        Number(
          receiverBalance!.availableBalance.toString(),
        );

      expect(totalBalance).toBe(12000);

      // ------------------------------------------------------
      // Verify transaction
      // ------------------------------------------------------

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
        transaction!.status,
      ).toBe("COMPLETED");

      expect(
        transaction!.amount.toString(),
      ).toBe("5000");

      expect(
        transaction!.currencyCode,
      ).toBe("BDT");

      createdTransactionIds.push(
        transaction!.id,
      );
    },
  );

  // ==========================================================
  // 14.9.2
  // Debit + credit records belong to same transaction
  // ==========================================================

  it(
    "should create the debit and credit records within the same transfer transaction",
    async () => {
      const sender = await createUser(
        `atomic-record-sender-${Date.now()}-${Math.random()}@test.com`,
      );

      const receiver = await createUser(
        `atomic-record-receiver-${Date.now()}-${Math.random()}@test.com`,
      );

      const senderAccount = await createAccount(
        sender.id,
        `ACC-ATOMIC-REC-S-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
      );

      const receiverAccount = await createAccount(
        receiver.id,
        `ACC-ATOMIC-REC-R-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
      );

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

      const response = await request(app)
        .post("/api/v1/transfers")
        .set(
          "Authorization",
          `Bearer ${accessToken}`,
        )
        .set(
          "Idempotency-Key",
          createIdempotencyKey(
            "atomic-records",
          ),
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

          orderBy: {
            createdAt: "desc",
          },
        });

      expect(transaction).not.toBeNull();

      createdTransactionIds.push(
        transaction!.id,
      );

      // ------------------------------------------------------
      // Both ledger entries must reference
      // the SAME transaction.
      // ------------------------------------------------------

      const ledgerEntries =
        await prisma.ledgerEntry.findMany({
          where: {
            transactionId:
              transaction!.id,
          },
        });

      expect(ledgerEntries).toHaveLength(2);

      // ------------------------------------------------------
      // Both transaction legs must reference
      // the SAME transaction.
      // ------------------------------------------------------

      const transactionLegs =
        await prisma.transactionLeg.findMany({
          where: {
            transactionId:
              transaction!.id,
          },
        });

      expect(transactionLegs).toHaveLength(2);

      // ------------------------------------------------------
      // Verify debit/credit account participation
      // ------------------------------------------------------

      const ledgerAccountIds =
        ledgerEntries.map(
          (entry) => entry.accountId,
        );

      expect(
        ledgerAccountIds,
      ).toContain(senderAccount.id);

      expect(
        ledgerAccountIds,
      ).toContain(receiverAccount.id);

      const legAccountIds =
        transactionLegs.map(
          (leg) => leg.accountId,
        );

      expect(
        legAccountIds,
      ).toContain(senderAccount.id);

      expect(
        legAccountIds,
      ).toContain(receiverAccount.id);
    },
  );

  // ==========================================================
  // 14.9.3
  // Failure after debit + credit → rollback
  // ==========================================================

  it(
    "should rollback both debit and credit when failure occurs after balance mutation",
    async () => {
      const sender = await createUser(
        `atomic-rollback-sender-${Date.now()}-${Math.random()}@test.com`,
      );

      const receiver = await createUser(
        `atomic-rollback-receiver-${Date.now()}-${Math.random()}@test.com`,
      );

      const senderAccount = await createAccount(
        sender.id,
        `ACC-ATOMIC-ROLL-S-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
      );

      const receiverAccount = await createAccount(
        receiver.id,
        `ACC-ATOMIC-ROLL-R-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
      );

      // ------------------------------------------------------
      // Initial state
      //
      // Sender   = 10,000
      // Receiver = 2,000
      // ------------------------------------------------------

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
        createIdempotencyKey(
          "atomic-post-mutation-failure",
        );

      // ------------------------------------------------------
      // Verify initial balances
      // ------------------------------------------------------

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
      ).toBe("2000");

      // ------------------------------------------------------
      // Enable test-only failure injection
      //
      // Existing service behavior:
      //
      // 1. Lock sender
      // 2. Lock receiver
      // 3. Debit sender
      // 4. Credit receiver
      // 5. Throw test failure
      // 6. Prisma rolls back transaction
      // ------------------------------------------------------

      const originalNodeEnv =
        process.env.NODE_ENV;

      const originalFailureFlag =
        process.env
          .TRANSFER_TEST_FAILURE_AFTER_MUTATION;

      try {
        process.env.NODE_ENV = "test";

        process.env.TRANSFER_TEST_FAILURE_AFTER_MUTATION =
          "true";

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

        // ----------------------------------------------------
        // Transfer must fail
        // ----------------------------------------------------

        expect(response.status).not.toBe(200);

        expect(
          response.body.success,
        ).toBe(false);
      } finally {
        // ----------------------------------------------------
        // Restore environment
        // ----------------------------------------------------

        if (
          originalNodeEnv === undefined
        ) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV =
            originalNodeEnv;
        }

        if (
          originalFailureFlag === undefined
        ) {
          delete process.env
            .TRANSFER_TEST_FAILURE_AFTER_MUTATION;
        } else {
          process.env
            .TRANSFER_TEST_FAILURE_AFTER_MUTATION =
            originalFailureFlag;
        }
      }

      // ------------------------------------------------------
      // Sender must be completely restored
      //
      // NOT 5,000
      // MUST be 10,000
      // ------------------------------------------------------

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

      // ------------------------------------------------------
      // Receiver must be completely restored
      //
      // NOT 7,000
      // MUST be 2,000
      // ------------------------------------------------------

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
      ).toBe("2000");

      // ------------------------------------------------------
      // Verify no transfer transaction survived
      // ------------------------------------------------------

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

              type: "INTERNAL_TRANSFER",
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

              type: "INTERNAL_TRANSFER",
            },
          },
        });

      expect(transactionLegs).toHaveLength(0);
    },
  );
});