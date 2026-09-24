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
  // Discover all transactions involving test accounts.
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
  // Delete transaction legs first
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
  return `lock-order-${Date.now()}-${suffix}-${Math.random()
    .toString(36)
    .slice(2)}`;
};

// ============================================================
// 14.6.4 Deterministic Lock Ordering
// ============================================================

describe(
  "14.6.4 Deterministic Lock Ordering",
  () => {
    // ========================================================
    // 14.6.4.a
    //
    // Opposite-direction concurrent transfers must complete
    // without deadlock and preserve financial integrity.
    // ========================================================

    it(
      "should safely handle concurrent opposite-direction transfers",
      async () => {
        // ----------------------------------------------------
        // Create users
        // ----------------------------------------------------

        const userA = await createUser(
          `lock-order-a-${Date.now()}@test.com`,
        );

        const userB = await createUser(
          `lock-order-b-${Date.now()}@test.com`,
        );

        // ----------------------------------------------------
        // Create accounts
        // ----------------------------------------------------

        const accountA =
          await createAccount(
            userA.id,
            `ACC-LOCK-ORDER-A-${Date.now()}`,
          );

        const accountB =
          await createAccount(
            userB.id,
            `ACC-LOCK-ORDER-B-${Date.now()}`,
          );

        // ----------------------------------------------------
        // Create balances
        //
        // Account A = 10,000
        // Account B = 10,000
        // ----------------------------------------------------

        await createBdtBalance(
          accountA.id,
          "10000",
        );

        await createBdtBalance(
          accountB.id,
          "10000",
        );

        // ----------------------------------------------------
        // Create access tokens
        // ----------------------------------------------------

        const accessTokenA =
          createAccessToken(userA);

        const accessTokenB =
          createAccessToken(userB);

        // ----------------------------------------------------
        // Concurrent transfer A → B
        // ----------------------------------------------------

        const transferAtoB = request(app)
          .post("/api/v1/transfers")
          .set(
            "Authorization",
            `Bearer ${accessTokenA}`,
          )
          .set(
            "Idempotency-Key",
            createIdempotencyKey("A-B"),
          )
          .send({
            senderAccount:
              accountA.accountNumber,
            receiverAccount:
              accountB.accountNumber,
            amount: "1000",
            currency: "BDT",
          });

        // ----------------------------------------------------
        // Concurrent transfer B → A
        // ----------------------------------------------------

        const transferBtoA = request(app)
          .post("/api/v1/transfers")
          .set(
            "Authorization",
            `Bearer ${accessTokenB}`,
          )
          .set(
            "Idempotency-Key",
            createIdempotencyKey("B-A"),
          )
          .send({
            senderAccount:
              accountB.accountNumber,
            receiverAccount:
              accountA.accountNumber,
            amount: "1000",
            currency: "BDT",
          });

        // ----------------------------------------------------
        // Execute concurrently.
        //
        // This is the important part of the test.
        // ----------------------------------------------------

        const [
          responseAtoB,
          responseBtoA,
        ] = await Promise.all([
          transferAtoB,
          transferBtoA,
        ]);

        // ----------------------------------------------------
        // Both transfers must succeed.
        //
        // If deterministic locking is working correctly,
        // neither transaction should deadlock.
        // ----------------------------------------------------

        expect(
          responseAtoB.status,
        ).toBe(200);

        expect(
          responseBtoA.status,
        ).toBe(200);

        // ----------------------------------------------------
        // Read Account A balance
        // ----------------------------------------------------

        const balanceA =
          await prisma.accountBalance.findUnique({
            where: {
              accountId_currencyCode: {
                accountId: accountA.id,
                currencyCode: "BDT",
              },
            },
          });

        expect(balanceA).not.toBeNull();

        // ----------------------------------------------------
        // Read Account B balance
        // ----------------------------------------------------

        const balanceB =
          await prisma.accountBalance.findUnique({
            where: {
              accountId_currencyCode: {
                accountId: accountB.id,
                currencyCode: "BDT",
              },
            },
          });

        expect(balanceB).not.toBeNull();

        // ----------------------------------------------------
        // Expected:
        //
        // Account A:
        //
        // 10,000
        // -1,000
        // +1,000
        // = 10,000
        //
        // Account B:
        //
        // 10,000
        // +1,000
        // -1,000
        // = 10,000
        // ----------------------------------------------------

        expect(
          balanceA?.availableBalance.toString(),
        ).toBe("10000");

        expect(
          balanceB?.availableBalance.toString(),
        ).toBe("10000");

        // ----------------------------------------------------
        // Verify A → B transaction
        // ----------------------------------------------------

        const transactionAtoB =
          await prisma.transaction.findMany({
            where: {
              sourceAccountId: accountA.id,
              destinationAccountId:
                accountB.id,
            },
          });

        expect(
          transactionAtoB,
        ).toHaveLength(1);

        // ----------------------------------------------------
        // Verify B → A transaction
        // ----------------------------------------------------

        const transactionBtoA =
          await prisma.transaction.findMany({
            where: {
              sourceAccountId: accountB.id,
              destinationAccountId:
                accountA.id,
            },
          });

        expect(
          transactionBtoA,
        ).toHaveLength(1);

        // ----------------------------------------------------
        // Verify transaction states
        // ----------------------------------------------------

        const transactions = [
          ...transactionAtoB,
          ...transactionBtoA,
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

        // ----------------------------------------------------
        // Financial conservation
        //
        // Before:
        //
        // A = 10,000
        // B = 10,000
        // Total = 20,000
        //
        // After:
        //
        // A = 10,000
        // B = 10,000
        // Total = 20,000
        // ----------------------------------------------------

        const totalAfter =
          Number(
            balanceA?.availableBalance.toString(),
          ) +
          Number(
            balanceB?.availableBalance.toString(),
          );

        expect(totalAfter).toBe(20000);
      },
      15000,
    );
  },
);