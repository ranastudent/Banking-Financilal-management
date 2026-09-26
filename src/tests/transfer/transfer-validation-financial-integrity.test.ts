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
// 14.7.7 Validation Financial Integrity
// ============================================================

describe(
  "14.7.7 Validation Financial Integrity",
  () => {
    // ========================================================
    // 14.7.7.1
    // Invalid account → no mutation
    // ========================================================

    it(
      "should not mutate financial state when the account is invalid",
      async () => {
        // ------------------------------------------------------
        // Create users
        // ------------------------------------------------------

        const sender = await createUser(
          `integrity-invalid-account-sender-${Date.now()}-${Math.random()}@test.com`,
        );

        const receiver = await createUser(
          `integrity-invalid-account-receiver-${Date.now()}-${Math.random()}@test.com`,
        );

        // ------------------------------------------------------
        // Create valid sender and receiver
        // ------------------------------------------------------

        const senderAccount = await createAccount(
          sender.id,
          `ACC-INTEGRITY-S-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`,
        );

        const receiverAccount = await createAccount(
          receiver.id,
          `ACC-INTEGRITY-R-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`,
        );

        // ------------------------------------------------------
        // Create balances
        // ------------------------------------------------------

        await createBdtBalance(
          senderAccount.id,
          "10000",
        );

        await createBdtBalance(
          receiverAccount.id,
          "5000",
        );

        // ------------------------------------------------------
        // Capture financial state BEFORE request
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

        // ------------------------------------------------------
        // Authentication
        // ------------------------------------------------------

        const accessToken =
          createAccessToken(sender);

        const invalidReceiverAccount =
          `ACC-NOT-EXIST-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`;

        // ------------------------------------------------------
        // Execute invalid transfer
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
              "invalid-account-integrity",
            ),
          )
          .send({
            senderAccount:
              senderAccount.accountNumber,

            receiverAccount:
              invalidReceiverAccount,

            amount: "1000",

            currency: "BDT",
          });

        // ------------------------------------------------------
        // Validation must fail
        // ------------------------------------------------------

        expect(response.status).toBe(404);

        expect(response.body.success).toBe(false);

        expect(response.body.error.code).toBe(
          "RESOURCE_NOT_FOUND",
        );

        // ------------------------------------------------------
        // Verify balances AFTER request
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
        ).toBe("10000");

        expect(
          afterReceiver!.availableBalance.toString(),
        ).toBe("5000");

        // ------------------------------------------------------
        // No transaction must be created
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
      },
    );

    // ========================================================
    // 14.7.7.2
    // Invalid currency → no mutation
    // ========================================================

    it(
      "should not mutate financial state when the currency is invalid",
      async () => {
        const sender = await createUser(
          `integrity-invalid-currency-sender-${Date.now()}-${Math.random()}@test.com`,
        );

        const receiver = await createUser(
          `integrity-invalid-currency-receiver-${Date.now()}-${Math.random()}@test.com`,
        );

        const senderAccount = await createAccount(
          sender.id,
          `ACC-INTEGRITY-CURRENCY-S-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`,
        );

        const receiverAccount = await createAccount(
          receiver.id,
          `ACC-INTEGRITY-CURRENCY-R-${Date.now()}-${Math.random()
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
        // Capture state BEFORE
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

        expect(
          beforeSender!.availableBalance.toString(),
        ).toBe("10000");

        expect(
          beforeReceiver!.availableBalance.toString(),
        ).toBe("5000");

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

        // ------------------------------------------------------
        // Authentication
        // ------------------------------------------------------

        const accessToken =
          createAccessToken(sender);

        // ------------------------------------------------------
        // Execute transfer with unknown currency
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
              "invalid-currency-integrity",
            ),
          )
          .send({
            senderAccount:
              senderAccount.accountNumber,

            receiverAccount:
              receiverAccount.accountNumber,

            amount: "1000",

            currency: "ZZZ",
          });

        // ------------------------------------------------------
        // Currency must be rejected
        // ------------------------------------------------------

        expect(response.status).toBe(404);

        expect(response.body.success).toBe(false);

        expect(response.body.error.code).toBe(
          "RESOURCE_NOT_FOUND",
        );

        // ------------------------------------------------------
        // Verify balances unchanged
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

        const afterReceiver =
          await prisma.accountBalance.findUnique({
            where: {
              accountId_currencyCode: {
                accountId: receiverAccount.id,
                currencyCode: "BDT",
              },
            },
          });

        expect(
          afterSender!.availableBalance.toString(),
        ).toBe("10000");

        expect(
          afterReceiver!.availableBalance.toString(),
        ).toBe("5000");

        // ------------------------------------------------------
        // No transaction
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
      },
    );

    // ========================================================
    // 14.7.7.3
    // Invalid account/currency combination → no mutation
    // ========================================================

    it(
      "should not mutate financial state when the account does not have the requested currency",
      async () => {
        const sender = await createUser(
          `integrity-account-currency-sender-${Date.now()}-${Math.random()}@test.com`,
        );

        const receiver = await createUser(
          `integrity-account-currency-receiver-${Date.now()}-${Math.random()}@test.com`,
        );

        const senderAccount = await createAccount(
          sender.id,
          `ACC-INTEGRITY-COMB-S-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`,
        );

        const receiverAccount = await createAccount(
          receiver.id,
          `ACC-INTEGRITY-COMB-R-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`,
        );

        // ------------------------------------------------------
        // Sender and receiver only have BDT.
        // ------------------------------------------------------

        await createBdtBalance(
          senderAccount.id,
          "10000",
        );

        await createBdtBalance(
          receiverAccount.id,
          "5000",
        );

        // ------------------------------------------------------
        // Capture BDT balances BEFORE
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

        // ------------------------------------------------------
        // Authentication
        // ------------------------------------------------------

        const accessToken =
          createAccessToken(sender);

        // ------------------------------------------------------
        // Request USD although both accounts
        // only have BDT.
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
              "invalid-account-currency-integrity",
            ),
          )
          .send({
            senderAccount:
              senderAccount.accountNumber,

            receiverAccount:
              receiverAccount.accountNumber,

            amount: "1000",

            currency: "USD",
          });

        // ------------------------------------------------------
        // Account/currency combination must fail
        // ------------------------------------------------------

        expect(response.status).toBe(409);

        expect(response.body.success).toBe(false);

        // ------------------------------------------------------
        // Verify BDT balances unchanged
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
        ).toBe("10000");

        expect(
          afterReceiver!.availableBalance.toString(),
        ).toBe("5000");

        // ------------------------------------------------------
        // No transaction
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
      },
    );
  },
);