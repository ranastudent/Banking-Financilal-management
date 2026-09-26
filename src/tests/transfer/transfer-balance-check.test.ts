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

  if (createdTransactionIds.length > 0) {
    await prisma.ledgerEntry.deleteMany({
      where: {
        transactionId: {
          in: createdTransactionIds,
        },
      },
    });
  }

  if (createdAccountIds.length > 0) {
    await prisma.transactionLeg.deleteMany({
      where: {
        accountId: {
          in: createdAccountIds,
        },
      },
    });
  }

  if (createdTransactionIds.length > 0) {
    await prisma.transaction.deleteMany({
      where: {
        id: {
          in: createdTransactionIds,
        },
      },
    });
  }

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

  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({
      where: {
        id: {
          in: createdUserIds,
        },
      },
    });
  }

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
// 14.8 Balance Check
// ============================================================

describe("14.8 Balance Check", () => {
  // ==========================================================
  // 14.8.1
  // Sufficient balance
  // ==========================================================

  it(
    "should allow transfer when available balance is greater than the transfer amount",
    async () => {
      const sender = await createUser(
        `balance-sufficient-sender-${Date.now()}-${Math.random()}@test.com`,
      );

      const receiver = await createUser(
        `balance-sufficient-receiver-${Date.now()}-${Math.random()}@test.com`,
      );

      const senderAccount = await createAccount(
        sender.id,
        `ACC-BALANCE-S-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
      );

      const receiverAccount = await createAccount(
        receiver.id,
        `ACC-BALANCE-R-${Date.now()}-${Math.random()
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

      const response = await request(app)
        .post("/api/v1/transfers")
        .set(
          "Authorization",
          `Bearer ${accessToken}`,
        )
        .set(
          "Idempotency-Key",
          createIdempotencyKey(
            "balance-sufficient",
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

      expect(response.body.success).toBe(true);

      expect(
        response.body.data.transaction.status,
      ).toBe("COMPLETED");

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

      expect(
        senderBalance!.availableBalance.toString(),
      ).toBe("5000");

      expect(
        receiverBalance!.availableBalance.toString(),
      ).toBe("10000");

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
    },
  );

  // ==========================================================
  // 14.8.2
  // Insufficient balance
  // ==========================================================

  it(
    "should reject the transfer when available balance is less than the transfer amount",
    async () => {
      const sender = await createUser(
        `balance-insufficient-sender-${Date.now()}-${Math.random()}@test.com`,
      );

      const receiver = await createUser(
        `balance-insufficient-receiver-${Date.now()}-${Math.random()}@test.com`,
      );

      const senderAccount = await createAccount(
        sender.id,
        `ACC-BALANCE-INS-S-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
      );

      const receiverAccount = await createAccount(
        receiver.id,
        `ACC-BALANCE-INS-R-${Date.now()}-${Math.random()
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
            "balance-insufficient",
          ),
        )
        .send({
          senderAccount:
            senderAccount.accountNumber,

          receiverAccount:
            receiverAccount.accountNumber,

          amount: "15000",

          currency: "BDT",
        });

      expect(response.status).toBe(409);

      expect(response.body.success).toBe(false);

      expect(
        response.body.error.code,
      ).toBe("INSUFFICIENT_BALANCE");

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

      // ------------------------------------------------------
      // No financial mutation
      // ------------------------------------------------------

      expect(
        senderBalance!.availableBalance.toString(),
      ).toBe("10000");

      expect(
        receiverBalance!.availableBalance.toString(),
      ).toBe("5000");

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
    },
  );

  // ==========================================================
  // 14.8.3
  // Exact balance
  // ==========================================================

  it(
    "should allow the transfer when available balance exactly equals the transfer amount",
    async () => {
      const sender = await createUser(
        `balance-exact-sender-${Date.now()}-${Math.random()}@test.com`,
      );

      const receiver = await createUser(
        `balance-exact-receiver-${Date.now()}-${Math.random()}@test.com`,
      );

      const senderAccount = await createAccount(
        sender.id,
        `ACC-BALANCE-EXACT-S-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
      );

      const receiverAccount = await createAccount(
        receiver.id,
        `ACC-BALANCE-EXACT-R-${Date.now()}-${Math.random()
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

      const response = await request(app)
        .post("/api/v1/transfers")
        .set(
          "Authorization",
          `Bearer ${accessToken}`,
        )
        .set(
          "Idempotency-Key",
          createIdempotencyKey(
            "balance-exact",
          ),
        )
        .send({
          senderAccount:
            senderAccount.accountNumber,

          receiverAccount:
            receiverAccount.accountNumber,

          amount: "10000",

          currency: "BDT",
        });

      expect(response.status).toBe(200);

      expect(response.body.success).toBe(true);

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

      expect(
        senderBalance!.availableBalance.toString(),
      ).toBe("0");

      expect(
        receiverBalance!.availableBalance.toString(),
      ).toBe("15000");

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
    },
  );

  // ==========================================================
  // 14.8.4
  // No financial mutation after insufficient balance
  // ==========================================================

  it(
    "should leave all financial state unchanged after an insufficient-balance rejection",
    async () => {
      const sender = await createUser(
        `balance-integrity-sender-${Date.now()}-${Math.random()}@test.com`,
      );

      const receiver = await createUser(
        `balance-integrity-receiver-${Date.now()}-${Math.random()}@test.com`,
      );

      const senderAccount = await createAccount(
        sender.id,
        `ACC-BALANCE-INTEGRITY-S-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
      );

      const receiverAccount = await createAccount(
        receiver.id,
        `ACC-BALANCE-INTEGRITY-R-${Date.now()}-${Math.random()
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

      // ------------------------------------------------------
      // Capture balances BEFORE
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
      ).toBe("5000");

      // ------------------------------------------------------
      // Capture transaction count
      // ------------------------------------------------------

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

      const accessToken =
        createAccessToken(sender);

      // ------------------------------------------------------
      // Execute insufficient transfer
      // ------------------------------------------------------

      const response = await request(app)
        .post("/api/v1/transfers")
        .set(
          "Authorization",
          `Bearer ${accessToken}`,
        )
        .set(
          "Idempotency-Key",
          createIdempotencyKey(
            "balance-integrity",
          ),
        )
        .send({
          senderAccount:
            senderAccount.accountNumber,

          receiverAccount:
            receiverAccount.accountNumber,

          amount: "15000",

          currency: "BDT",
        });

      expect(response.status).toBe(409);

      expect(response.body.success).toBe(false);

      expect(
        response.body.error.code,
      ).toBe("INSUFFICIENT_BALANCE");

      // ------------------------------------------------------
      // Verify sender balance unchanged
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
      // Verify receiver balance unchanged
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
      ).toBe("5000");

      // ------------------------------------------------------
      // Verify no transaction was created
      // ------------------------------------------------------

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

      // ------------------------------------------------------
      // Verify no ledger entries were created
      // ------------------------------------------------------

      const transactionIds =
        await prisma.transaction.findMany({
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
          select: {
            id: true,
          },
        });

      expect(transactionIds).toHaveLength(0);
    },
  );
});