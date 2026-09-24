import request from "supertest";
import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import { prisma } from "../../config/prisma";
import app from "../../app";
import { generateAccessToken } from "../../auth/utils/jwt";

// ============================================================
// Test State
// ============================================================

const createdUserIds: string[] = [];
const createdAccountIds: string[] = [];

// ============================================================
// Cleanup
// ============================================================

afterEach(async () => {
  // ----------------------------------------------------------
  // Discover every transaction involving test accounts.
  // ----------------------------------------------------------

  let transactionIds: string[] = [];

  if (createdAccountIds.length > 0) {
    const transactions =
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

    transactionIds = transactions.map(
      (transaction) => transaction.id,
    );
  }

  // ----------------------------------------------------------
  // Delete transaction legs FIRST
  // ----------------------------------------------------------

  if (transactionIds.length > 0) {
    await prisma.transactionLeg.deleteMany({
      where: {
        transactionId: {
          in: transactionIds,
        },
      },
    });

    // --------------------------------------------------------
    // Delete ledger entries
    // --------------------------------------------------------

    await prisma.ledgerEntry.deleteMany({
      where: {
        transactionId: {
          in: transactionIds,
        },
      },
    });

    // --------------------------------------------------------
    // Delete transactions
    // --------------------------------------------------------

    await prisma.transaction.deleteMany({
      where: {
        id: {
          in: transactionIds,
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
  // Reset state
  // ----------------------------------------------------------

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
// Create unique idempotency key
// ------------------------------------------------------------

const createIdempotencyKey = (
  suffix: string,
) => {
  return `receiver-lock-${Date.now()}-${suffix}-${Math.random()
    .toString(36)
    .slice(2)}`;
};

// ============================================================
// 14.6.3 Receiver Account Locking
// ============================================================

describe("14.6.3 Receiver Account Locking", () => {
  // ==========================================================
  // 14.6.3.a
  //
  // Concurrent transfers from different senders to the same
  // receiver must preserve the receiver balance.
  // ==========================================================

  it(
    "should safely serialize concurrent transfers to the same receiver account",
    async () => {
      // ------------------------------------------------------
      // Create sender users
      // ------------------------------------------------------

      const senderUser1 = await createUser(
        `receiver-lock-sender-1-${Date.now()}@test.com`,
      );

      const senderUser2 = await createUser(
        `receiver-lock-sender-2-${Date.now()}@test.com`,
      );

      // ------------------------------------------------------
      // Create receiver user
      // ------------------------------------------------------

      const receiverUser = await createUser(
        `receiver-lock-target-${Date.now()}@test.com`,
      );

      // ------------------------------------------------------
      // Create sender accounts
      // ------------------------------------------------------

      const senderAccount1 =
        await createAccount(
          senderUser1.id,
          `ACC-RECEIVER-LOCK-S1-${Date.now()}`,
        );

      const senderAccount2 =
        await createAccount(
          senderUser2.id,
          `ACC-RECEIVER-LOCK-S2-${Date.now()}`,
        );

      // ------------------------------------------------------
      // Create receiver account
      // ------------------------------------------------------

      const receiverAccount =
        await createAccount(
          receiverUser.id,
          `ACC-RECEIVER-LOCK-R-${Date.now()}`,
        );

      // ------------------------------------------------------
      // Create balances
      //
      // Sender 1 = 10,000
      // Sender 2 = 10,000
      // Receiver = 5,000
      // ------------------------------------------------------

      await createBdtBalance(
        senderAccount1.id,
        "10000",
      );

      await createBdtBalance(
        senderAccount2.id,
        "10000",
      );

      await createBdtBalance(
        receiverAccount.id,
        "5000",
      );

      // ------------------------------------------------------
      // Create access tokens
      // ------------------------------------------------------

      const accessToken1 =
        createAccessToken(senderUser1);

      const accessToken2 =
        createAccessToken(senderUser2);

      // ------------------------------------------------------
      // Build concurrent transfer requests
      //
      // Sender 1 → Receiver = 1,000
      // Sender 2 → Receiver = 1,000
      // ------------------------------------------------------

      const transfer1 = request(app)
        .post("/api/v1/transfers")
        .set(
          "Authorization",
          `Bearer ${accessToken1}`,
        )
        .set(
          "Idempotency-Key",
          createIdempotencyKey("A"),
        )
        .send({
          senderAccount:
            senderAccount1.accountNumber,
          receiverAccount:
            receiverAccount.accountNumber,
          amount: "1000",
          currency: "BDT",
        });

      const transfer2 = request(app)
        .post("/api/v1/transfers")
        .set(
          "Authorization",
          `Bearer ${accessToken2}`,
        )
        .set(
          "Idempotency-Key",
          createIdempotencyKey("B"),
        )
        .send({
          senderAccount:
            senderAccount2.accountNumber,
          receiverAccount:
            receiverAccount.accountNumber,
          amount: "1000",
          currency: "BDT",
        });

      // ------------------------------------------------------
      // Execute concurrently
      // ------------------------------------------------------

      const [
        response1,
        response2,
      ] = await Promise.all([
        transfer1,
        transfer2,
      ]);

      // ------------------------------------------------------
      // Both transfers must succeed
      // ------------------------------------------------------

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);

      // ------------------------------------------------------
      // Verify sender 1 balance
      // ------------------------------------------------------

      const senderBalance1 =
        await prisma.accountBalance.findUnique({
          where: {
            accountId_currencyCode: {
              accountId: senderAccount1.id,
              currencyCode: "BDT",
            },
          },
        });

      expect(senderBalance1).not.toBeNull();

      expect(
        senderBalance1?.availableBalance.toString(),
      ).toBe("9000");

      // ------------------------------------------------------
      // Verify sender 2 balance
      // ------------------------------------------------------

      const senderBalance2 =
        await prisma.accountBalance.findUnique({
          where: {
            accountId_currencyCode: {
              accountId: senderAccount2.id,
              currencyCode: "BDT",
            },
          },
        });

      expect(senderBalance2).not.toBeNull();

      expect(
        senderBalance2?.availableBalance.toString(),
      ).toBe("9000");

      // ------------------------------------------------------
      // Verify receiver balance
      //
      // Initial = 5,000
      // Transfer 1 = +1,000
      // Transfer 2 = +1,000
      //
      // Final = 7,000
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
      ).toBe("7000");

      // ------------------------------------------------------
      // Verify transactions
      // ------------------------------------------------------

      const sender1Transactions =
        await prisma.transaction.findMany({
          where: {
            sourceAccountId:
              senderAccount1.id,
            destinationAccountId:
              receiverAccount.id,
          },
        });

      const sender2Transactions =
        await prisma.transaction.findMany({
          where: {
            sourceAccountId:
              senderAccount2.id,
            destinationAccountId:
              receiverAccount.id,
          },
        });

      expect(
        sender1Transactions,
      ).toHaveLength(1);

      expect(
        sender2Transactions,
      ).toHaveLength(1);

      // ------------------------------------------------------
      // Verify transaction properties
      // ------------------------------------------------------

      const transactions = [
        ...sender1Transactions,
        ...sender2Transactions,
      ];

      for (const transaction of transactions) {
        expect(transaction.type).toBe(
          "INTERNAL_TRANSFER",
        );

        expect(transaction.status).toBe(
          "COMPLETED",
        );

        expect(
          transaction.amount.toString(),
        ).toBe("1000");

        expect(
          transaction.currencyCode,
        ).toBe("BDT");
      }

      // ------------------------------------------------------
      // Financial conservation
      //
      // Before:
      //
      // Sender 1 = 10,000
      // Sender 2 = 10,000
      // Receiver = 5,000
      //
      // Total = 25,000
      //
      // After:
      //
      // Sender 1 = 9,000
      // Sender 2 = 9,000
      // Receiver = 7,000
      //
      // Total = 25,000
      // ------------------------------------------------------

      const totalAfter =
        Number(
          senderBalance1?.availableBalance.toString(),
        ) +
        Number(
          senderBalance2?.availableBalance.toString(),
        ) +
        Number(
          receiverBalance?.availableBalance.toString(),
        );

      expect(totalAfter).toBe(25000);
    },
    15000,
  );
});