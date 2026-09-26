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
// 14.7.5 Account/Currency Compatibility
// ============================================================

describe(
  "14.7.5 Account/Currency Compatibility",
  () => {
    // ========================================================
    // 14.7.5.1
    // Sender has requested currency
    // ========================================================

    it(
      "should accept a transfer when the sender has the requested currency",
      async () => {
        // ----------------------------------------------------
        // Create users
        // ----------------------------------------------------

        const sender = await createUser(
          `compat-sender-currency-${Date.now()}-${Math.random()}@test.com`,
        );

        const receiver = await createUser(
          `compat-sender-currency-receiver-${Date.now()}-${Math.random()}@test.com`,
        );

        // ----------------------------------------------------
        // Create accounts
        // ----------------------------------------------------

        const senderAccount =
          await createAccount(
            sender.id,
            `ACC-COMPAT-S-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 8)}`,
          );

        const receiverAccount =
          await createAccount(
            receiver.id,
            `ACC-COMPAT-S-R-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 8)}`,
          );

        // ----------------------------------------------------
        // Sender has requested BDT currency
        // ----------------------------------------------------

        await createBdtBalance(
          senderAccount.id,
          "10000",
        );

        // Receiver also needs BDT for a valid same-currency
        // transfer.
        // ----------------------------------------------------

        await createBdtBalance(
          receiverAccount.id,
          "5000",
        );

        // ----------------------------------------------------
        // Verify sender BDT balance exists
        // ----------------------------------------------------

        const senderBalance =
          await prisma.accountBalance.findUnique(
            {
              where: {
                accountId_currencyCode: {
                  accountId:
                    senderAccount.id,
                  currencyCode: "BDT",
                },
              },
            },
          );

        expect(senderBalance).not.toBeNull();

        expect(
          senderBalance!.currencyCode,
        ).toBe("BDT");

        // ----------------------------------------------------
        // Authentication
        // ----------------------------------------------------

        const accessToken =
          createAccessToken(sender);

        const idempotencyKey =
          createIdempotencyKey(
            "sender-currency",
          );

        // ----------------------------------------------------
        // Execute transfer
        // ----------------------------------------------------

        const response =
          await request(app)
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

        // ----------------------------------------------------
        // Transfer must succeed
        // ----------------------------------------------------

        expect(response.status).toBe(200);

        expect(response.body.success).toBe(
          true,
        );

        expect(
          response.body.data.transaction
            .currencyCode,
        ).toBe("BDT");

        // ----------------------------------------------------
        // Verify transaction
        // ----------------------------------------------------

        const transaction =
          await prisma.transaction.findFirst(
            {
              where: {
                sourceAccountId:
                  senderAccount.id,

                destinationAccountId:
                  receiverAccount.id,

                type: "INTERNAL_TRANSFER",

                currencyCode: "BDT",
              },

              orderBy: {
                createdAt: "desc",
              },
            },
          );

        expect(transaction).not.toBeNull();

        if (transaction) {
          createdTransactionIds.push(
            transaction.id,
          );
        }
      },
    );

    // ========================================================
    // 14.7.5.2
    // Receiver has requested currency
    // ========================================================

    it(
      "should accept a transfer when the receiver has the requested currency",
      async () => {
        // ----------------------------------------------------
        // Create users
        // ----------------------------------------------------

        const sender = await createUser(
          `compat-receiver-currency-sender-${Date.now()}-${Math.random()}@test.com`,
        );

        const receiver = await createUser(
          `compat-receiver-currency-${Date.now()}-${Math.random()}@test.com`,
        );

        // ----------------------------------------------------
        // Create accounts
        // ----------------------------------------------------

        const senderAccount =
          await createAccount(
            sender.id,
            `ACC-COMPAT-R-S-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 8)}`,
          );

        const receiverAccount =
          await createAccount(
            receiver.id,
            `ACC-COMPAT-R-R-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 8)}`,
          );

        // ----------------------------------------------------
        // Sender has BDT
        // ----------------------------------------------------

        await createBdtBalance(
          senderAccount.id,
          "10000",
        );

        // ----------------------------------------------------
        // Receiver has requested BDT
        // ----------------------------------------------------

        await createBdtBalance(
          receiverAccount.id,
          "5000",
        );

        // ----------------------------------------------------
        // Verify receiver BDT balance exists
        // ----------------------------------------------------

        const receiverBalance =
          await prisma.accountBalance.findUnique(
            {
              where: {
                accountId_currencyCode: {
                  accountId:
                    receiverAccount.id,
                  currencyCode: "BDT",
                },
              },
            },
          );

        expect(receiverBalance).not.toBeNull();

        expect(
          receiverBalance!.currencyCode,
        ).toBe("BDT");

        // ----------------------------------------------------
        // Authentication
        // ----------------------------------------------------

        const accessToken =
          createAccessToken(sender);

        const idempotencyKey =
          createIdempotencyKey(
            "receiver-currency",
          );

        // ----------------------------------------------------
        // Execute transfer
        // ----------------------------------------------------

        const response =
          await request(app)
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

        // ----------------------------------------------------
        // Transfer must succeed
        // ----------------------------------------------------

        expect(response.status).toBe(200);

        expect(response.body.success).toBe(
          true,
        );

        expect(
          response.body.data.transaction
            .currencyCode,
        ).toBe("BDT");

        // ----------------------------------------------------
        // Verify transaction
        // ----------------------------------------------------

        const transaction =
          await prisma.transaction.findFirst(
            {
              where: {
                sourceAccountId:
                  senderAccount.id,

                destinationAccountId:
                  receiverAccount.id,

                type: "INTERNAL_TRANSFER",

                currencyCode: "BDT",
              },

              orderBy: {
                createdAt: "desc",
              },
            },
          );

        expect(transaction).not.toBeNull();

        if (transaction) {
          createdTransactionIds.push(
            transaction.id,
          );
        }
      },
    );

    // ========================================================
    // 14.7.5.3
    // Missing sender balance rejected
    // ========================================================

    it(
      "should reject a transfer when the sender does not have the requested currency balance",
      async () => {
        // ----------------------------------------------------
        // Create users
        // ----------------------------------------------------

        const sender = await createUser(
          `compat-missing-sender-${Date.now()}-${Math.random()}@test.com`,
        );

        const receiver = await createUser(
          `compat-missing-sender-receiver-${Date.now()}-${Math.random()}@test.com`,
        );

        // ----------------------------------------------------
        // Create accounts
        // ----------------------------------------------------

        const senderAccount =
          await createAccount(
            sender.id,
            `ACC-COMPAT-MISSING-S-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 8)}`,
          );

        const receiverAccount =
          await createAccount(
            receiver.id,
            `ACC-COMPAT-MISSING-S-R-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 8)}`,
          );

        // ----------------------------------------------------
        // IMPORTANT:
        // Do NOT create BDT balance for sender.
        // --------------------------------------------------------

        await createBdtBalance(
          receiverAccount.id,
          "5000",
        );

        // ----------------------------------------------------
        // Confirm sender BDT balance is missing
        // ----------------------------------------------------

        const senderBalance =
          await prisma.accountBalance.findUnique(
            {
              where: {
                accountId_currencyCode: {
                  accountId:
                    senderAccount.id,
                  currencyCode: "BDT",
                },
              },
            },
          );

        expect(senderBalance).toBeNull();

        // ----------------------------------------------------
        // Capture receiver balance
        // ----------------------------------------------------

        const beforeReceiver =
          await prisma.accountBalance.findUnique(
            {
              where: {
                accountId_currencyCode: {
                  accountId:
                    receiverAccount.id,
                  currencyCode: "BDT",
                },
              },
            },
          );

        expect(beforeReceiver).not.toBeNull();

        expect(
          beforeReceiver!.availableBalance.toString(),
        ).toBe("5000");

        // ----------------------------------------------------
        // Count transactions
        // ----------------------------------------------------

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

        // ----------------------------------------------------
        // Authentication
        // ----------------------------------------------------

        const accessToken =
          createAccessToken(sender);

        const idempotencyKey =
          createIdempotencyKey(
            "missing-sender-currency",
          );

        // ----------------------------------------------------
        // Execute transfer
        // ----------------------------------------------------

        const response =
          await request(app)
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

        // ----------------------------------------------------
        // Missing sender currency must be rejected
        // ----------------------------------------------------

        expect(response.status).toBe(409);

        expect(response.body.success).toBe(
          false,
        );

        // ----------------------------------------------------
        // Receiver balance unchanged
        // ----------------------------------------------------

        const afterReceiver =
          await prisma.accountBalance.findUnique(
            {
              where: {
                accountId_currencyCode: {
                  accountId:
                    receiverAccount.id,
                  currencyCode: "BDT",
                },
              },
            },
          );

        expect(afterReceiver).not.toBeNull();

        expect(
          afterReceiver!.availableBalance.toString(),
        ).toBe("5000");

        // ----------------------------------------------------
        // No transaction may be created
        // ----------------------------------------------------

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

    // ========================================================
    // 14.7.5.4
    // Missing receiver balance rejected
    // ========================================================

    it(
      "should reject a transfer when the receiver does not have the requested currency balance",
      async () => {
        // ----------------------------------------------------
        // Create users
        // ----------------------------------------------------

        const sender = await createUser(
          `compat-missing-receiver-${Date.now()}-${Math.random()}@test.com`,
        );

        const receiver = await createUser(
          `compat-missing-receiver-owner-${Date.now()}-${Math.random()}@test.com`,
        );

        // ----------------------------------------------------
        // Create accounts
        // ----------------------------------------------------

        const senderAccount =
          await createAccount(
            sender.id,
            `ACC-COMPAT-MISSING-R-S-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 8)}`,
          );

        const receiverAccount =
          await createAccount(
            receiver.id,
            `ACC-COMPAT-MISSING-R-R-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 8)}`,
          );

        // ----------------------------------------------------
        // Sender has BDT
        // ----------------------------------------------------

        await createBdtBalance(
          senderAccount.id,
          "10000",
        );

        // ----------------------------------------------------
        // IMPORTANT:
        // Do NOT create BDT balance for receiver.
        // ----------------------------------------------------

        // ----------------------------------------------------
        // Confirm receiver BDT balance is missing
        // ----------------------------------------------------

        const receiverBalance =
          await prisma.accountBalance.findUnique(
            {
              where: {
                accountId_currencyCode: {
                  accountId:
                    receiverAccount.id,
                  currencyCode: "BDT",
                },
              },
            },
          );

        expect(receiverBalance).toBeNull();

        // ----------------------------------------------------
        // Capture sender balance
        // ----------------------------------------------------

        const beforeSender =
          await prisma.accountBalance.findUnique(
            {
              where: {
                accountId_currencyCode: {
                  accountId:
                    senderAccount.id,
                  currencyCode: "BDT",
                },
              },
            },
          );

        expect(beforeSender).not.toBeNull();

        expect(
          beforeSender!.availableBalance.toString(),
        ).toBe("10000");

        // ----------------------------------------------------
        // Count transactions
        // ----------------------------------------------------

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

        // ----------------------------------------------------
        // Authentication
        // ----------------------------------------------------

        const accessToken =
          createAccessToken(sender);

        const idempotencyKey =
          createIdempotencyKey(
            "missing-receiver-currency",
          );

        // ----------------------------------------------------
        // Execute transfer
        // ----------------------------------------------------

        const response =
          await request(app)
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

        // ----------------------------------------------------
        // Missing receiver currency must be rejected
        // ----------------------------------------------------

        expect(response.status).toBe(409);

        expect(response.body.success).toBe(
          false,
        );

        // ----------------------------------------------------
        // Sender balance unchanged
        // ----------------------------------------------------

        const afterSender =
          await prisma.accountBalance.findUnique(
            {
              where: {
                accountId_currencyCode: {
                  accountId:
                    senderAccount.id,
                  currencyCode: "BDT",
                },
              },
            },
          );

        expect(afterSender).not.toBeNull();

        expect(
          afterSender!.availableBalance.toString(),
        ).toBe("10000");

        // ----------------------------------------------------
        // Receiver still has no BDT balance
        // ----------------------------------------------------

        const afterReceiver =
          await prisma.accountBalance.findUnique(
            {
              where: {
                accountId_currencyCode: {
                  accountId:
                    receiverAccount.id,
                  currencyCode: "BDT",
                },
              },
            },
          );

        expect(afterReceiver).toBeNull();

        // ----------------------------------------------------
        // No transaction may be created
        // ----------------------------------------------------

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
  },
);