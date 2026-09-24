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
  return `debit-credit-${Date.now()}-${suffix}-${Math.random()
    .toString(36)
    .slice(2)}`;
};

describe("14.6.6.2 Debit = Credit", () => {
  it(
    "should maintain equal total debit and credit across completed transfers",
    async () => {
      // ---------------------------------------------------------
      // Arrange
      // ---------------------------------------------------------

      const senderUser = await createUser(
        `debit-credit-sender-${Date.now()}@test.com`,
      );

      const receiverUser = await createUser(
        `debit-credit-receiver-${Date.now()}@test.com`,
      );

      const timestamp = Date.now();

      const senderAccount = await createAccount(
        senderUser.id,
        `ACC-DEBIT-CREDIT-SENDER-${timestamp}`,
      );

      const receiverAccount = await createAccount(
        receiverUser.id,
        `ACC-DEBIT-CREDIT-RECEIVER-${timestamp}`,
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
        createAccessToken(senderUser);

      // ---------------------------------------------------------
      // Act
      // ---------------------------------------------------------

      const responseA = await request(app)
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
            receiverAccount.accountNumber,
          amount: "1000",
          currency: "BDT",
        });

      const responseB = await request(app)
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
            receiverAccount.accountNumber,
          amount: "2000",
          currency: "BDT",
        });

      // ---------------------------------------------------------
      // Response integrity
      // ---------------------------------------------------------

      expect(responseA.status).toBe(200);
      expect(responseB.status).toBe(200);

      // ---------------------------------------------------------
      // Load completed transactions
      // ---------------------------------------------------------

      const transactions =
        await prisma.transaction.findMany({
          where: {
            sourceAccountId: senderAccount.id,
            destinationAccountId:
              receiverAccount.id,
            status: "COMPLETED",
          },
        });

      expect(transactions).toHaveLength(2);

      // ---------------------------------------------------------
      // Load ledger entries
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

      expect(ledgerEntries).toHaveLength(4);

      // ---------------------------------------------------------
      // Calculate debit and credit totals
      // ---------------------------------------------------------

      const debitEntries =
        ledgerEntries.filter(
          (entry) =>
            entry.entryType === "DEBIT",
        );

      const creditEntries =
        ledgerEntries.filter(
          (entry) =>
            entry.entryType === "CREDIT",
        );

      expect(debitEntries).toHaveLength(2);
      expect(creditEntries).toHaveLength(2);

      const totalDebit =
        debitEntries.reduce(
          (sum, entry) =>
            sum +
            Number(entry.amount.toString()),
          0,
        );

      const totalCredit =
        creditEntries.reduce(
          (sum, entry) =>
            sum +
            Number(entry.amount.toString()),
          0,
        );

      // ---------------------------------------------------------
      // Core accounting invariant
      // ---------------------------------------------------------

      expect(totalDebit).toBe(3000);
      expect(totalCredit).toBe(3000);

      expect(totalDebit).toBe(
        totalCredit,
      );

      // ---------------------------------------------------------
      // Verify every transaction has
      // exactly one debit and one credit
      // ---------------------------------------------------------

      for (const transactionId of transactionIds) {
        const entriesForTransaction =
          ledgerEntries.filter(
            (entry) =>
              entry.transactionId ===
              transactionId,
          );

        expect(
          entriesForTransaction,
        ).toHaveLength(2);

        expect(
          entriesForTransaction.filter(
            (entry) =>
              entry.entryType === "DEBIT",
          ),
        ).toHaveLength(1);

        expect(
          entriesForTransaction.filter(
            (entry) =>
              entry.entryType === "CREDIT",
          ),
        ).toHaveLength(1);
      }

      // ---------------------------------------------------------
      // Verify final account balances
      // ---------------------------------------------------------

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

      expect(senderBalance).not.toBeNull();
      expect(receiverBalance).not.toBeNull();

      expect(
        senderBalance?.availableBalance.toString(),
      ).toBe("7000");

      expect(
        receiverBalance?.availableBalance.toString(),
      ).toBe("8000");

      // ---------------------------------------------------------
      // Total money conservation
      // ---------------------------------------------------------

      const totalAfter =
        Number(
          senderBalance?.availableBalance.toString(),
        ) +
        Number(
          receiverBalance?.availableBalance.toString(),
        );

      expect(totalAfter).toBe(15000);
    },
    15000,
  );
});