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
  return `ledger-transaction-${Date.now()}-${suffix}-${Math.random()
    .toString(36)
    .slice(2)}`;
};

describe("14.6.6.3 Ledger = Transaction", () => {
  it(
    "should maintain a complete ledger representation for every completed transaction",
    async () => {
      // ---------------------------------------------------------
      // Arrange
      // ---------------------------------------------------------

      const senderUser = await createUser(
        `ledger-transaction-sender-${Date.now()}@test.com`,
      );

      const receiverUser = await createUser(
        `ledger-transaction-receiver-${Date.now()}@test.com`,
      );

      const timestamp = Date.now();

      const senderAccount = await createAccount(
        senderUser.id,
        `ACC-LEDGER-TX-SENDER-${timestamp}`,
      );

      const receiverAccount = await createAccount(
        receiverUser.id,
        `ACC-LEDGER-TX-RECEIVER-${timestamp}`,
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

      expect(responseA.status).toBe(200);
      expect(responseB.status).toBe(200);

      // ---------------------------------------------------------
      // Load transactions
      // ---------------------------------------------------------

      const transactions =
        await prisma.transaction.findMany({
          where: {
            sourceAccountId: senderAccount.id,
            destinationAccountId:
              receiverAccount.id,
            status: "COMPLETED",
          },
          orderBy: {
            createdAt: "asc",
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
      // Transaction → Ledger mapping
      // ---------------------------------------------------------

      for (const transaction of transactions) {
        const entriesForTransaction =
          ledgerEntries.filter(
            (entry) =>
              entry.transactionId ===
              transaction.id,
          );

        // Every completed transaction must
        // have exactly two ledger entries.
        expect(
          entriesForTransaction,
        ).toHaveLength(2);

        const debitEntry =
          entriesForTransaction.find(
            (entry) =>
              entry.entryType === "DEBIT",
          );

        const creditEntry =
          entriesForTransaction.find(
            (entry) =>
              entry.entryType === "CREDIT",
          );

        expect(debitEntry).toBeDefined();
        expect(creditEntry).toBeDefined();

        // -------------------------------------------------------
        // Amount consistency
        // -------------------------------------------------------

        expect(
          debitEntry?.amount.toString(),
        ).toBe(
          transaction.amount.toString(),
        );

        expect(
          creditEntry?.amount.toString(),
        ).toBe(
          transaction.amount.toString(),
        );

        // -------------------------------------------------------
        // Currency consistency
        // -------------------------------------------------------

        expect(
          debitEntry?.currencyCode,
        ).toBe(transaction.currencyCode);

        expect(
          creditEntry?.currencyCode,
        ).toBe(transaction.currencyCode);

        // -------------------------------------------------------
        // Account consistency
        // -------------------------------------------------------

        expect(
          debitEntry?.accountId,
        ).toBe(transaction.sourceAccountId);

        expect(
          creditEntry?.accountId,
        ).toBe(transaction.destinationAccountId);
      }

      // ---------------------------------------------------------
      // Verify no orphan ledger entries exist
      // ---------------------------------------------------------

      const orphanLedgerEntries =
        await prisma.ledgerEntry.findMany({
          where: {
            transactionId: {
              notIn: transactionIds,
            },
            accountId: {
              in: [
                senderAccount.id,
                receiverAccount.id,
              ],
            },
          },
        });

      expect(
        orphanLedgerEntries,
      ).toHaveLength(0);

      // ---------------------------------------------------------
      // Verify transaction ↔ ledger cardinality
      // ---------------------------------------------------------

      expect(ledgerEntries.length).toBe(
        transactions.length * 2,
      );
    },
    15000,
  );
});