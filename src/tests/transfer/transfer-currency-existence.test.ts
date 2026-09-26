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

const createdCurrencyCodes: string[] = [];

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
  // Delete temporary currencies
  // ----------------------------------------------------------

  if (createdCurrencyCodes.length > 0) {
    await prisma.currency.deleteMany({
      where: {
        code: {
          in: createdCurrencyCodes,
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

  createdCurrencyCodes.length = 0;

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
// Create temporary inactive currency
// ------------------------------------------------------------

const createInactiveCurrency = async () => {
  const code = `X${Math.random()
    .toString(36)
    .slice(2, 3)
    .toUpperCase()}${Math.floor(
    Math.random() * 10,
  )}`;

  const currency = await prisma.currency.create({
    data: {
      code,
      name: `Test Inactive Currency ${Date.now()}`,
      symbol: null,
      decimalPlaces: 2,
      isActive: false,
    },
  });

  createdCurrencyCodes.push(currency.code);

  return currency;
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
// 14.7.4 Currency Existence Validation
// ============================================================

describe("14.7.4 Currency Existence Validation", () => {
  // ==========================================================
  // 14.7.4.1
  // Existing currency accepted
  // ==========================================================

  it("should accept an existing active currency", async () => {
    // --------------------------------------------------------
    // Create users
    // --------------------------------------------------------

    const sender = await createUser(
      `currency-existing-sender-${Date.now()}-${Math.random()}@test.com`,
    );

    const receiver = await createUser(
      `currency-existing-receiver-${Date.now()}-${Math.random()}@test.com`,
    );

    // --------------------------------------------------------
    // Create accounts
    // --------------------------------------------------------

    const senderAccount = await createAccount(
      sender.id,
      `ACC-CURRENCY-EXIST-S-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );

    const receiverAccount = await createAccount(
      receiver.id,
      `ACC-CURRENCY-EXIST-R-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );

    // --------------------------------------------------------
    // Create BDT balances
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
    // Verify BDT exists and is active
    // --------------------------------------------------------

    const currency =
      await prisma.currency.findUnique({
        where: {
          code: "BDT",
        },
      });

    expect(currency).not.toBeNull();

    expect(currency!.isActive).toBe(true);

    // --------------------------------------------------------
    // Authentication
    // --------------------------------------------------------

    const accessToken =
      createAccessToken(sender);

    const idempotencyKey =
      createIdempotencyKey(
        "existing-currency",
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
    // Existing active currency must be accepted
    // --------------------------------------------------------

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(
      response.body.data.transaction.type,
    ).toBe("INTERNAL_TRANSFER");

    expect(
      response.body.data.transaction.status,
    ).toBe("COMPLETED");

    expect(
      response.body.data.transaction.currencyCode,
    ).toBe("BDT");

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

          currencyCode: "BDT",
        },

        orderBy: {
          createdAt: "desc",
        },
      });

    expect(transaction).not.toBeNull();

    expect(
      transaction?.currencyCode,
    ).toBe("BDT");

    if (transaction) {
      createdTransactionIds.push(
        transaction.id,
      );
    }
  });

  // ==========================================================
  // 14.7.4.2
  // Unknown currency rejected
  // ==========================================================

  it("should reject an unknown currency", async () => {
    // --------------------------------------------------------
    // Create users
    // --------------------------------------------------------

    const sender = await createUser(
      `currency-unknown-sender-${Date.now()}-${Math.random()}@test.com`,
    );

    const receiver = await createUser(
      `currency-unknown-receiver-${Date.now()}-${Math.random()}@test.com`,
    );

    // --------------------------------------------------------
    // Create accounts
    // --------------------------------------------------------

    const senderAccount = await createAccount(
      sender.id,
      `ACC-CURRENCY-UNKNOWN-S-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );

    const receiverAccount = await createAccount(
      receiver.id,
      `ACC-CURRENCY-UNKNOWN-R-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );

    // --------------------------------------------------------
    // Create valid BDT balances
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
    // Unknown currency
    // --------------------------------------------------------

    const unknownCurrency = "ZZZ";

    const existingCurrency =
      await prisma.currency.findUnique({
        where: {
          code: unknownCurrency,
        },
      });

    expect(existingCurrency).toBeNull();

    // --------------------------------------------------------
    // Capture balances before request
    // --------------------------------------------------------

    const beforeSender =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId:
              senderAccount.id,
            currencyCode: "BDT",
          },
        },
      });

    const beforeReceiver =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId:
              receiverAccount.id,
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
        "unknown-currency",
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

        currency: unknownCurrency,
      });

    // --------------------------------------------------------
    // Unknown currency must be rejected
    // --------------------------------------------------------

    expect(response.status).toBe(404);

    expect(response.body.success).toBe(false);

    expect(response.body.error.code).toBe(
      "RESOURCE_NOT_FOUND",
    );

    // --------------------------------------------------------
    // Sender balance unchanged
    // --------------------------------------------------------

    const afterSender =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId:
              senderAccount.id,
            currencyCode: "BDT",
          },
        },
      });

    expect(afterSender).not.toBeNull();

    expect(
      afterSender!.availableBalance.toString(),
    ).toBe("10000");

    // --------------------------------------------------------
    // Receiver balance unchanged
    // --------------------------------------------------------

    const afterReceiver =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId:
              receiverAccount.id,
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
  // 14.7.4.3
  // Inactive currency rejected
  // ==========================================================

  it("should reject an inactive currency", async () => {
    // --------------------------------------------------------
    // Create users
    // --------------------------------------------------------

    const sender = await createUser(
      `currency-inactive-sender-${Date.now()}-${Math.random()}@test.com`,
    );

    const receiver = await createUser(
      `currency-inactive-receiver-${Date.now()}-${Math.random()}@test.com`,
    );

    // --------------------------------------------------------
    // Create accounts
    // --------------------------------------------------------

    const senderAccount = await createAccount(
      sender.id,
      `ACC-CURRENCY-INACTIVE-S-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );

    const receiverAccount = await createAccount(
      receiver.id,
      `ACC-CURRENCY-INACTIVE-R-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );

    // --------------------------------------------------------
    // Create BDT balances
    //
    // These are intentionally valid because the test is
    // verifying currency existence/state, not balance
    // compatibility.
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
    // Create inactive currency
    // --------------------------------------------------------

    const inactiveCurrency =
      await createInactiveCurrency();

    expect(inactiveCurrency.isActive).toBe(
      false,
    );

    // --------------------------------------------------------
    // Verify currency exists but is inactive
    // --------------------------------------------------------

    const storedCurrency =
      await prisma.currency.findUnique({
        where: {
          code: inactiveCurrency.code,
        },
      });

    expect(storedCurrency).not.toBeNull();

    expect(
      storedCurrency!.isActive,
    ).toBe(false);

    // --------------------------------------------------------
    // Capture balances before request
    // --------------------------------------------------------

    const beforeSender =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId:
              senderAccount.id,
            currencyCode: "BDT",
          },
        },
      });

    const beforeReceiver =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId:
              receiverAccount.id,
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
        "inactive-currency",
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

        currency:
          inactiveCurrency.code,
      });

    // --------------------------------------------------------
    // Inactive currency must be rejected
    // --------------------------------------------------------

    expect(response.status).toBe(400);

    expect(response.body.success).toBe(false);

    // --------------------------------------------------------
    // Sender balance unchanged
    // --------------------------------------------------------

    const afterSender =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId:
              senderAccount.id,
            currencyCode: "BDT",
          },
        },
      });

    expect(afterSender).not.toBeNull();

    expect(
      afterSender!.availableBalance.toString(),
    ).toBe("10000");

    // --------------------------------------------------------
    // Receiver balance unchanged
    // --------------------------------------------------------

    const afterReceiver =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId:
              receiverAccount.id,
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