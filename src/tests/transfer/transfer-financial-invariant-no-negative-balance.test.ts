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
  role: "CUSTOMER" | "ADMIN" | "SUPPORT" | "AUDITOR";
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

describe("14.6.6.1 No Negative Balance", () => {
  it(
    "should prevent transfers that would make the sender balance negative",
    async () => {
      // ---------------------------------------------------------
      // Arrange
      // ---------------------------------------------------------

      const senderUser = await createUser(
        `no-negative-sender-${Date.now()}@test.com`,
      );

      const receiverUser = await createUser(
        `no-negative-receiver-${Date.now()}@test.com`,
      );

      const timestamp = Date.now();

      const senderAccount = await createAccount(
        senderUser.id,
        `ACC-NO-NEGATIVE-SENDER-${timestamp}`,
      );

      const receiverAccount = await createAccount(
        receiverUser.id,
        `ACC-NO-NEGATIVE-RECEIVER-${timestamp}`,
      );

      await createBdtBalance(
        senderAccount.id,
        "1000",
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

      const response = await request(app)
        .post("/api/v1/transfers")
        .set(
          "Authorization",
          `Bearer ${accessToken}`,
        )
        .set(
          "Idempotency-Key",
          `no-negative-${Date.now()}-${Math.random()}`,
        )
        .send({
          senderAccount:
            senderAccount.accountNumber,
          receiverAccount:
            receiverAccount.accountNumber,
          amount: "1500",
          currency: "BDT",
        });

      // ---------------------------------------------------------
      // Response
      // ---------------------------------------------------------

      expect(response.status).toBe(409);

      // ---------------------------------------------------------
      // Verify balances were NOT modified
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
      ).toBe("1000");

      expect(
        receiverBalance?.availableBalance.toString(),
      ).toBe("5000");

      // ---------------------------------------------------------
      // Verify no financial records were created
      // ---------------------------------------------------------

      const transactions =
        await prisma.transaction.findMany({
          where: {
            OR: [
              {
                sourceAccountId:
                  senderAccount.id,
                destinationAccountId:
                  receiverAccount.id,
              },
              {
                sourceAccountId:
                  receiverAccount.id,
                destinationAccountId:
                  senderAccount.id,
              },
            ],
          },
        });

      expect(transactions).toHaveLength(0);

      const ledgerEntries =
        await prisma.ledgerEntry.findMany({
          where: {
            accountId: {
              in: [
                senderAccount.id,
                receiverAccount.id,
              ],
            },
          },
        });

      expect(ledgerEntries).toHaveLength(0);

      // ---------------------------------------------------------
      // Financial invariant
      // ---------------------------------------------------------

      expect(
        Number(
          senderBalance?.availableBalance.toString(),
        ),
      ).toBeGreaterThanOrEqual(0);

      expect(
        Number(
          receiverBalance?.availableBalance.toString(),
        ),
      ).toBeGreaterThanOrEqual(0);
    },
    15000,
  );
});