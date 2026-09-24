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
  // Delete transaction legs FIRST.
  //
  // This is important because transaction legs reference
  // accounts through transaction_legs_account_id_fkey.
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
  return `sender-lock-${Date.now()}-${suffix}-${Math.random()
    .toString(36)
    .slice(2)}`;
};

// ============================================================
// 14.6.2 Sender Account Locking
// ============================================================

describe("14.6.2 Sender Account Locking", () => {
  // ==========================================================
  // 14.6.2.a
  //
  // Concurrent operations using the same sender account
  // must not corrupt the sender balance.
  // ==========================================================

  it(
    "should safely serialize concurrent transfers from the same sender account",
    async () => {
      // ------------------------------------------------------
      // Create sender
      // ------------------------------------------------------

      const senderUser = await createUser(
        `sender-lock-${Date.now()}@test.com`,
      );

      // ------------------------------------------------------
      // Create receiver users
      // ------------------------------------------------------

      const receiverUser1 = await createUser(
        `receiver-lock-1-${Date.now()}@test.com`,
      );

      const receiverUser2 = await createUser(
        `receiver-lock-2-${Date.now()}@test.com`,
      );

      // ------------------------------------------------------
      // Create accounts
      // ------------------------------------------------------

      const senderAccount =
        await createAccount(
          senderUser.id,
          `ACC-SENDER-LOCK-${Date.now()}`,
        );

      const receiverAccount1 =
        await createAccount(
          receiverUser1.id,
          `ACC-RECEIVER-LOCK-1-${Date.now()}`,
        );

      const receiverAccount2 =
        await createAccount(
          receiverUser2.id,
          `ACC-RECEIVER-LOCK-2-${Date.now()}`,
        );

      // ------------------------------------------------------
      // Create balances
      // ------------------------------------------------------

      await createBdtBalance(
        senderAccount.id,
        "10000",
      );

      await createBdtBalance(
        receiverAccount1.id,
        "1000",
      );

      await createBdtBalance(
        receiverAccount2.id,
        "1000",
      );

      // ------------------------------------------------------
      // Create authentication token
      // ------------------------------------------------------

      const accessToken =
        createAccessToken(senderUser);

      // ------------------------------------------------------
      // Build concurrent requests
      // ------------------------------------------------------

      const transfer1 = request(app)
        .post("/api/v1/transfers")
        .set(
          "Authorization",
          `Bearer ${accessToken}`,
        )
        .set(
          "Idempotency-Key",
          createIdempotencyKey("A"),
        )
        .send({
          senderAccount:
            senderAccount.accountNumber,
          receiverAccount:
            receiverAccount1.accountNumber,
          amount: "1000",
          currency: "BDT",
        });

      const transfer2 = request(app)
        .post("/api/v1/transfers")
        .set(
          "Authorization",
          `Bearer ${accessToken}`,
        )
        .set(
          "Idempotency-Key",
          createIdempotencyKey("B"),
        )
        .send({
          senderAccount:
            senderAccount.accountNumber,
          receiverAccount:
            receiverAccount2.accountNumber,
          amount: "1000",
          currency: "BDT",
        });

      // ------------------------------------------------------
      // Execute both requests concurrently.
      // ------------------------------------------------------

      const [
        response1,
        response2,
      ] = await Promise.all([
        transfer1,
        transfer2,
      ]);

      // ------------------------------------------------------
      // Both operations must succeed.
      // ------------------------------------------------------

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);

      // ------------------------------------------------------
      // Verify sender balance.
      //
      // Initial:
      // 10,000
      //
      // Transfer A:
      // -1,000
      //
      // Transfer B:
      // -1,000
      //
      // Final:
      // 8,000
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
      ).toBe("8000");

      // ------------------------------------------------------
      // Verify receiver 1.
      // ------------------------------------------------------

      const receiverBalance1 =
        await prisma.accountBalance.findUnique({
          where: {
            accountId_currencyCode: {
              accountId: receiverAccount1.id,
              currencyCode: "BDT",
            },
          },
        });

      expect(receiverBalance1).not.toBeNull();

      expect(
        receiverBalance1?.availableBalance.toString(),
      ).toBe("2000");

      // ------------------------------------------------------
      // Verify receiver 2.
      // ------------------------------------------------------

      const receiverBalance2 =
        await prisma.accountBalance.findUnique({
          where: {
            accountId_currencyCode: {
              accountId: receiverAccount2.id,
              currencyCode: "BDT",
            },
          },
        });

      expect(receiverBalance2).not.toBeNull();

      expect(
        receiverBalance2?.availableBalance.toString(),
      ).toBe("2000");

      // ------------------------------------------------------
      // Verify exactly two transactions.
      // ------------------------------------------------------

      const transactions =
        await prisma.transaction.findMany({
          where: {
            sourceAccountId:
              senderAccount.id,
          },
        });

      expect(transactions).toHaveLength(2);

      // ------------------------------------------------------
      // Verify transaction status/type.
      // ------------------------------------------------------

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
      // Financial conservation.
      //
      // Before:
      //
      // Sender   = 10,000
      // Receiver = 1,000
      // Receiver = 1,000
      //
      // Total = 12,000
      //
      // After:
      //
      // Sender   = 8,000
      // Receiver = 2,000
      // Receiver = 2,000
      //
      // Total = 12,000
      // ------------------------------------------------------

      const totalAfter =
        Number(
          senderBalance?.availableBalance.toString(),
        ) +
        Number(
          receiverBalance1?.availableBalance.toString(),
        ) +
        Number(
          receiverBalance2?.availableBalance.toString(),
        );

      expect(totalAfter).toBe(12000);
    },
    15000,
  );
});