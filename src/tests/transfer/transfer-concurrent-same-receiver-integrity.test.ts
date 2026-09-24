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
          { sourceAccountId: { in: createdAccountIds } },
          { destinationAccountId: { in: createdAccountIds } },
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
  return `same-receiver-${Date.now()}-${suffix}-${Math.random()
    .toString(36)
    .slice(2)}`;
};

describe("14.6.5.2 Multiple Senders → Same Receiver", () => {
  it(
    "should preserve receiver balance during concurrent transfers from multiple senders",
    async () => {
      // ---------------------------------------------------------
      // Arrange
      // ---------------------------------------------------------

      const senderUserA = await createUser(
        `same-receiver-sender-a-${Date.now()}@test.com`,
      );

      const senderUserB = await createUser(
        `same-receiver-sender-b-${Date.now()}@test.com`,
      );

      const receiverUser = await createUser(
        `same-receiver-receiver-${Date.now()}@test.com`,
      );

      const timestamp = Date.now();

      const senderAccountA = await createAccount(
        senderUserA.id,
        `ACC-SAME-RECEIVER-A-${timestamp}`,
      );

      const senderAccountB = await createAccount(
        senderUserB.id,
        `ACC-SAME-RECEIVER-B-${timestamp}`,
      );

      const receiverAccount = await createAccount(
        receiverUser.id,
        `ACC-SAME-RECEIVER-${timestamp}`,
      );

      // Initial balances:
      //
      // Sender A   = 10,000
      // Sender B   = 10,000
      // Receiver   = 5,000
      //
      // Total      = 25,000

      await createBdtBalance(
        senderAccountA.id,
        "10000",
      );

      await createBdtBalance(
        senderAccountB.id,
        "10000",
      );

      await createBdtBalance(
        receiverAccount.id,
        "5000",
      );

      const accessTokenA = createAccessToken(
        senderUserA,
      );

      const accessTokenB = createAccessToken(
        senderUserB,
      );

      // ---------------------------------------------------------
      // Act
      // ---------------------------------------------------------

      const transferA = request(app)
        .post("/api/v1/transfers")
        .set(
          "Authorization",
          `Bearer ${accessTokenA}`,
        )
        .set(
          "Idempotency-Key",
          createIdempotencyKey("A"),
        )
        .send({
          senderAccount:
            senderAccountA.accountNumber,
          receiverAccount:
            receiverAccount.accountNumber,
          amount: "1000",
          currency: "BDT",
        });

      const transferB = request(app)
        .post("/api/v1/transfers")
        .set(
          "Authorization",
          `Bearer ${accessTokenB}`,
        )
        .set(
          "Idempotency-Key",
          createIdempotencyKey("B"),
        )
        .send({
          senderAccount:
            senderAccountB.accountNumber,
          receiverAccount:
            receiverAccount.accountNumber,
          amount: "1000",
          currency: "BDT",
        });

      const [
        responseA,
        responseB,
      ] = await Promise.all([
        transferA,
        transferB,
      ]);

      // ---------------------------------------------------------
      // Response integrity
      // ---------------------------------------------------------

      expect(responseA.status).toBe(200);
      expect(responseB.status).toBe(200);

      // ---------------------------------------------------------
      // Read final balances
      // ---------------------------------------------------------

      const senderBalanceA =
        await prisma.accountBalance.findUnique({
          where: {
            accountId_currencyCode: {
              accountId: senderAccountA.id,
              currencyCode: "BDT",
            },
          },
        });

      const senderBalanceB =
        await prisma.accountBalance.findUnique({
          where: {
            accountId_currencyCode: {
              accountId: senderAccountB.id,
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

      // ---------------------------------------------------------
      // Balance integrity
      // ---------------------------------------------------------

      expect(senderBalanceA).not.toBeNull();
      expect(senderBalanceB).not.toBeNull();
      expect(receiverBalance).not.toBeNull();

      expect(
        senderBalanceA?.availableBalance.toString(),
      ).toBe("9000");

      expect(
        senderBalanceB?.availableBalance.toString(),
      ).toBe("9000");

      expect(
        receiverBalance?.availableBalance.toString(),
      ).toBe("7000");

      // ---------------------------------------------------------
      // Transaction integrity
      // ---------------------------------------------------------

      const transactions =
        await prisma.transaction.findMany({
          where: {
            destinationAccountId:
              receiverAccount.id,
            sourceAccountId: {
              in: [
                senderAccountA.id,
                senderAccountB.id,
              ],
            },
          },
        });

      expect(transactions).toHaveLength(2);

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

        expect(transaction.currencyCode).toBe(
          "BDT",
        );

        expect(
          transaction.destinationAccountId,
        ).toBe(receiverAccount.id);
      }

      // ---------------------------------------------------------
      // Ledger integrity
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

        const debitEntries =
          entriesForTransaction.filter(
            (entry) =>
              entry.entryType === "DEBIT",
          );

        const creditEntries =
          entriesForTransaction.filter(
            (entry) =>
              entry.entryType === "CREDIT",
          );

        expect(debitEntries).toHaveLength(1);
        expect(creditEntries).toHaveLength(1);
      }

      // ---------------------------------------------------------
      // Financial invariant
      // ---------------------------------------------------------

      const totalAfter =
        Number(
          senderBalanceA?.availableBalance.toString(),
        ) +
        Number(
          senderBalanceB?.availableBalance.toString(),
        ) +
        Number(
          receiverBalance?.availableBalance.toString(),
        );

      expect(totalAfter).toBe(25000);
    },
    15000,
  );
});