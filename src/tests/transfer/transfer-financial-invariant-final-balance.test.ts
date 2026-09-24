import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma";
import app from "../../app";
import { generateAccessToken } from "../../auth/utils/jwt";

const createdUserIds: string[] = [];
const createdAccountIds: string[] = [];

afterEach(async () => {
  let transactionIds: string[] = [];

  if (createdAccountIds.length > 0) {
    const transactions = await prisma.transaction.findMany({
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

  if (transactionIds.length > 0) {
    await prisma.transactionLeg.deleteMany({
      where: {
        transactionId: {
          in: transactionIds,
        },
      },
    });

    await prisma.ledgerEntry.deleteMany({
      where: {
        transactionId: {
          in: transactionIds,
        },
      },
    });

    await prisma.transaction.deleteMany({
      where: {
        id: {
          in: transactionIds,
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

  createdAccountIds.length = 0;
  createdUserIds.length = 0;
});

const createUser = async (email: string) => {
  const user = await prisma.user.create({
    data: {
      name: `Test User ${Date.now()}-${Math.random()}`,
      email,
      passwordHash: "test-password-hash",
      role: "CUSTOMER",
      status: "ACTIVE",
    },
  });

  createdUserIds.push(user.id);

  return user;
};

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

const createIdempotencyKey = (suffix: string) => {
  return `final-balance-${Date.now()}-${suffix}-${Math.random()
    .toString(36)
    .slice(2)}`;
};

describe("14.6.6.4 Account Balance = Expected Final Balance", () => {
  it(
    "should produce the mathematically expected final balances after multiple transfers",
    async () => {
      // ---------------------------------------------------------
      // Arrange
      // ---------------------------------------------------------

      const userA = await createUser(
        `final-balance-a-${Date.now()}@test.com`,
      );

      const userB = await createUser(
        `final-balance-b-${Date.now()}@test.com`,
      );

      const timestamp = Date.now();

      const accountA = await createAccount(
        userA.id,
        `ACC-FINAL-BALANCE-A-${timestamp}`,
      );

      const accountB = await createAccount(
        userB.id,
        `ACC-FINAL-BALANCE-B-${timestamp}`,
      );

      // Initial:
      //
      // A = 20,000
      // B = 10,000
      // Total = 30,000

      await createBdtBalance(
        accountA.id,
        "20000",
      );

      await createBdtBalance(
        accountB.id,
        "10000",
      );

      const tokenA = createAccessToken(userA);
      const tokenB = createAccessToken(userB);

      // ---------------------------------------------------------
      // Transfer 1
      // A → B = 2,000
      // ---------------------------------------------------------

      const response1 = await request(app)
        .post("/api/v1/transfers")
        .set(
          "Authorization",
          `Bearer ${tokenA}`,
        )
        .set(
          "Idempotency-Key",
          createIdempotencyKey("A-B-2000"),
        )
        .send({
          senderAccount:
            accountA.accountNumber,
          receiverAccount:
            accountB.accountNumber,
          amount: "2000",
          currency: "BDT",
        });

      expect(response1.status).toBe(200);

      // ---------------------------------------------------------
      // Transfer 2
      // A → B = 3,000
      // ---------------------------------------------------------

      const response2 = await request(app)
        .post("/api/v1/transfers")
        .set(
          "Authorization",
          `Bearer ${tokenA}`,
        )
        .set(
          "Idempotency-Key",
          createIdempotencyKey("A-B-3000"),
        )
        .send({
          senderAccount:
            accountA.accountNumber,
          receiverAccount:
            accountB.accountNumber,
          amount: "3000",
          currency: "BDT",
        });

      expect(response2.status).toBe(200);

      // ---------------------------------------------------------
      // Transfer 3
      // B → A = 1,000
      // ---------------------------------------------------------

      const response3 = await request(app)
        .post("/api/v1/transfers")
        .set(
          "Authorization",
          `Bearer ${tokenB}`,
        )
        .set(
          "Idempotency-Key",
          createIdempotencyKey("B-A-1000"),
        )
        .send({
          senderAccount:
            accountB.accountNumber,
          receiverAccount:
            accountA.accountNumber,
          amount: "1000",
          currency: "BDT",
        });

      expect(response3.status).toBe(200);

      // ---------------------------------------------------------
      // Expected mathematical result
      // ---------------------------------------------------------

      // Account A:
      //
      // 20,000
      // - 2,000
      // - 3,000
      // + 1,000
      // = 16,000

      const expectedAccountABalance = 16000;

      // Account B:
      //
      // 10,000
      // + 2,000
      // + 3,000
      // - 1,000
      // = 14,000

      const expectedAccountBBalance = 14000;

      // ---------------------------------------------------------
      // Read actual database balances
      // ---------------------------------------------------------

      const balanceA =
        await prisma.accountBalance.findUnique({
          where: {
            accountId_currencyCode: {
              accountId: accountA.id,
              currencyCode: "BDT",
            },
          },
        });

      const balanceB =
        await prisma.accountBalance.findUnique({
          where: {
            accountId_currencyCode: {
              accountId: accountB.id,
              currencyCode: "BDT",
            },
          },
        });

      expect(balanceA).not.toBeNull();
      expect(balanceB).not.toBeNull();

      const actualAccountABalance = Number(
        balanceA?.availableBalance.toString(),
      );

      const actualAccountBBalance = Number(
        balanceB?.availableBalance.toString(),
      );

      // ---------------------------------------------------------
      // Core invariant
      // ---------------------------------------------------------

      expect(actualAccountABalance).toBe(
        expectedAccountABalance,
      );

      expect(actualAccountBBalance).toBe(
        expectedAccountBBalance,
      );

      // ---------------------------------------------------------
      // Total money conservation
      // ---------------------------------------------------------

      const initialTotal = 30000;

      const finalTotal =
        actualAccountABalance +
        actualAccountBBalance;

      expect(finalTotal).toBe(initialTotal);

      // ---------------------------------------------------------
      // Transaction verification
      // ---------------------------------------------------------

      const transactions =
        await prisma.transaction.findMany({
          where: {
            OR: [
              {
                sourceAccountId: accountA.id,
                destinationAccountId:
                  accountB.id,
              },
              {
                sourceAccountId: accountB.id,
                destinationAccountId:
                  accountA.id,
              },
            ],
            status: "COMPLETED",
          },
        });

      expect(transactions).toHaveLength(3);

      // ---------------------------------------------------------
      // Ledger verification
      // ---------------------------------------------------------

      const transactionIds = transactions.map(
        (transaction) => transaction.id,
      );

      const ledgerEntries =
        await prisma.ledgerEntry.findMany({
          where: {
            transactionId: {
              in: transactionIds,
            },
          },
        });

      expect(ledgerEntries).toHaveLength(6);

      // ---------------------------------------------------------
      // Final accounting invariant
      // ---------------------------------------------------------

      const totalDebit =
        ledgerEntries
          .filter(
            (entry) =>
              entry.entryType === "DEBIT",
          )
          .reduce(
            (sum, entry) =>
              sum +
              Number(entry.amount.toString()),
            0,
          );

      const totalCredit =
        ledgerEntries
          .filter(
            (entry) =>
              entry.entryType === "CREDIT",
          )
          .reduce(
            (sum, entry) =>
              sum +
              Number(entry.amount.toString()),
            0,
          );

      expect(totalDebit).toBe(
        totalCredit,
      );

      expect(totalDebit).toBe(6000);
      expect(totalCredit).toBe(6000);
    },
    15000,
  );
});