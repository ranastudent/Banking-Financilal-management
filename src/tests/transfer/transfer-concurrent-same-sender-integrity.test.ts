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
      select: { id: true },
    });

    transactionIds = transactions.map((transaction) => transaction.id);
  }

  if (transactionIds.length > 0) {
    await prisma.transactionLeg.deleteMany({
      where: {
        transactionId: { in: transactionIds },
      },
    });

    await prisma.ledgerEntry.deleteMany({
      where: {
        transactionId: { in: transactionIds },
      },
    });

    await prisma.transaction.deleteMany({
      where: {
        id: { in: transactionIds },
      },
    });
  }

  if (createdAccountIds.length > 0) {
    await prisma.accountBalance.deleteMany({
      where: {
        accountId: { in: createdAccountIds },
      },
    });

    await prisma.account.deleteMany({
      where: {
        id: { in: createdAccountIds },
      },
    });
  }

  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({
      where: {
        id: { in: createdUserIds },
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
  return `same-sender-${Date.now()}-${suffix}-${Math.random()
    .toString(36)
    .slice(2)}`;
};

describe("14.6.5.1 Same Sender → Multiple Receivers", () => {
  it(
    "should preserve sender balance during concurrent transfers to multiple receivers",
    async () => {
      // ---------------------------------------------------------
      // Arrange
      // ---------------------------------------------------------

      const senderUser = await createUser(
        `same-sender-${Date.now()}@test.com`,
      );

      const receiverUserA = await createUser(
        `same-receiver-a-${Date.now()}@test.com`,
      );

      const receiverUserB = await createUser(
        `same-receiver-b-${Date.now()}@test.com`,
      );

      const receiverUserC = await createUser(
        `same-receiver-c-${Date.now()}@test.com`,
      );

      const timestamp = Date.now();

      const senderAccount = await createAccount(
        senderUser.id,
        `ACC-SAME-SENDER-${timestamp}`,
      );

      const receiverAccountA = await createAccount(
        receiverUserA.id,
        `ACC-SAME-SENDER-A-${timestamp}`,
      );

      const receiverAccountB = await createAccount(
        receiverUserB.id,
        `ACC-SAME-SENDER-B-${timestamp}`,
      );

      const receiverAccountC = await createAccount(
        receiverUserC.id,
        `ACC-SAME-SENDER-C-${timestamp}`,
      );

      await createBdtBalance(senderAccount.id, "10000");

      await createBdtBalance(
        receiverAccountA.id,
        "1000",
      );

      await createBdtBalance(
        receiverAccountB.id,
        "1000",
      );

      await createBdtBalance(
        receiverAccountC.id,
        "1000",
      );

      const senderToken = createAccessToken(senderUser);

      // ---------------------------------------------------------
      // Act
      // ---------------------------------------------------------

      const transferA = request(app)
        .post("/api/v1/transfers")
        .set("Authorization", `Bearer ${senderToken}`)
        .set(
          "Idempotency-Key",
          createIdempotencyKey("A"),
        )
        .send({
          senderAccount: senderAccount.accountNumber,
          receiverAccount: receiverAccountA.accountNumber,
          amount: "1000",
          currency: "BDT",
        });

      const transferB = request(app)
        .post("/api/v1/transfers")
        .set("Authorization", `Bearer ${senderToken}`)
        .set(
          "Idempotency-Key",
          createIdempotencyKey("B"),
        )
        .send({
          senderAccount: senderAccount.accountNumber,
          receiverAccount: receiverAccountB.accountNumber,
          amount: "1000",
          currency: "BDT",
        });

      const transferC = request(app)
        .post("/api/v1/transfers")
        .set("Authorization", `Bearer ${senderToken}`)
        .set(
          "Idempotency-Key",
          createIdempotencyKey("C"),
        )
        .send({
          senderAccount: senderAccount.accountNumber,
          receiverAccount: receiverAccountC.accountNumber,
          amount: "1000",
          currency: "BDT",
        });

      const [
        responseA,
        responseB,
        responseC,
      ] = await Promise.all([
        transferA,
        transferB,
        transferC,
      ]);

      // ---------------------------------------------------------
      // Response integrity
      // ---------------------------------------------------------

      expect(responseA.status).toBe(200);
      expect(responseB.status).toBe(200);
      expect(responseC.status).toBe(200);

      // ---------------------------------------------------------
      // Read final balances
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

      const receiverBalanceA =
        await prisma.accountBalance.findUnique({
          where: {
            accountId_currencyCode: {
              accountId: receiverAccountA.id,
              currencyCode: "BDT",
            },
          },
        });

      const receiverBalanceB =
        await prisma.accountBalance.findUnique({
          where: {
            accountId_currencyCode: {
              accountId: receiverAccountB.id,
              currencyCode: "BDT",
            },
          },
        });

      const receiverBalanceC =
        await prisma.accountBalance.findUnique({
          where: {
            accountId_currencyCode: {
              accountId: receiverAccountC.id,
              currencyCode: "BDT",
            },
          },
        });

      // ---------------------------------------------------------
      // Balance integrity
      // ---------------------------------------------------------

      expect(senderBalance).not.toBeNull();
      expect(receiverBalanceA).not.toBeNull();
      expect(receiverBalanceB).not.toBeNull();
      expect(receiverBalanceC).not.toBeNull();

      expect(
        senderBalance?.availableBalance.toString(),
      ).toBe("7000");

      expect(
        receiverBalanceA?.availableBalance.toString(),
      ).toBe("2000");

      expect(
        receiverBalanceB?.availableBalance.toString(),
      ).toBe("2000");

      expect(
        receiverBalanceC?.availableBalance.toString(),
      ).toBe("2000");

      // ---------------------------------------------------------
      // Transaction integrity
      // ---------------------------------------------------------

      const transactions =
        await prisma.transaction.findMany({
          where: {
            OR: [
              {
                sourceAccountId: senderAccount.id,
                destinationAccountId:
                  receiverAccountA.id,
              },
              {
                sourceAccountId: senderAccount.id,
                destinationAccountId:
                  receiverAccountB.id,
              },
              {
                sourceAccountId: senderAccount.id,
                destinationAccountId:
                  receiverAccountC.id,
              },
            ],
          },
        });

      expect(transactions).toHaveLength(3);

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

      expect(ledgerEntries).toHaveLength(6);

      // Every transfer must have exactly:
      // 1 DEBIT + 1 CREDIT
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
          senderBalance?.availableBalance.toString(),
        ) +
        Number(
          receiverBalanceA?.availableBalance.toString(),
        ) +
        Number(
          receiverBalanceB?.availableBalance.toString(),
        ) +
        Number(
          receiverBalanceC?.availableBalance.toString(),
        );

      expect(totalAfter).toBe(13000);
    },
    15000,
  );
});