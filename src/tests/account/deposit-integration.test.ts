import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { Prisma, UserRole, UserStatus } from "@prisma/client";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { hashPassword } from "../../auth/utils/password";
import { generateAccessToken } from "../../auth/utils/jwt";

const createdUserIds: string[] = [];
const createdAccountIds: string[] = [];

const createTestUser = async (
  role: UserRole = UserRole.CUSTOMER,
) => {
  const user = await prisma.user.create({
    data: {
      name: `Deposit Integration User ${Date.now()}-${Math.random()}`,
      email: `deposit-integration-${Date.now()}-${Math.random()}@test.local`,
      passwordHash: await hashPassword("TestPassword123!"),
      role,
      status: UserStatus.ACTIVE,
    },
  });

  createdUserIds.push(user.id);

  return user;
};

const createTestAccount = async (
  userId: string,
  balance = "10000.00",
) => {
  const account = await prisma.account.create({
    data: {
      userId,
      accountNumber: `DINT-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      accountType: "SAVINGS",
      status: "ACTIVE",
    },
  });

  createdAccountIds.push(account.id);

  await prisma.accountBalance.create({
    data: {
      accountId: account.id,
      currencyCode: "BDT",
      availableBalance: new Prisma.Decimal(balance),
      lockedBalance: new Prisma.Decimal("0"),
    },
  });

  return account;
};

const createAccessToken = (user: {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
}) => {
  return generateAccessToken({
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
  });
};

afterEach(async () => {
  if (createdAccountIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: {
        userId: {
          in: createdUserIds,
        },
      },
    });

    await prisma.ledgerEntry.deleteMany({
      where: {
        accountId: {
          in: createdAccountIds,
        },
      },
    });

    await prisma.transactionLeg.deleteMany({
      where: {
        accountId: {
          in: createdAccountIds,
        },
      },
    });

    await prisma.transaction.deleteMany({
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
    });

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

    createdAccountIds.length = 0;
  }

  if (createdUserIds.length > 0) {
    await prisma.idempotencyRecord.deleteMany({
      where: {
        userId: {
          in: createdUserIds,
        },
      },
    });

    await prisma.refreshToken.deleteMany({
      where: {
        userId: {
          in: createdUserIds,
        },
      },
    });

    await prisma.emailVerificationOtp.deleteMany({
      where: {
        userId: {
          in: createdUserIds,
        },
      },
    });

    await prisma.user.deleteMany({
      where: {
        id: {
          in: createdUserIds,
        },
      },
    });

    createdUserIds.length = 0;
  }
});

describe("12.11.1 Deposit Integration", () => {
  it("should complete a customer deposit through the full HTTP flow", async () => {
    const user = await createTestUser();
    const account = await createTestAccount(
      user.id,
      "10000.00",
    );

    const accessToken = createAccessToken(user);

    const response = await request(app)
      .post(`/api/v1/accounts/${account.id}/deposits`)
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", `deposit-int-${Date.now()}`)
      .send({
        amount: "500.00",
        currency: "BDT",
      });

    expect(response.status).toBe(200);

    expect(response.body.success).toBe(true);

    expect(response.body.requestId).toBeDefined();

    expect(response.body.data.accountId).toBe(
      account.id,
    );

    expect(response.body.data.currency).toBe("BDT");

    expect(response.body.data.amount).toBe("500");

    expect(response.body.data.balance).toBeDefined();

    expect(
      response.body.data.balance.balanceBefore,
    ).toBe("10000");

    expect(
      response.body.data.balance.balanceAfter,
    ).toBe("10500");

    expect(
      response.body.data.transaction,
    ).toBeDefined();

    expect(
      response.body.data.transaction.type,
    ).toBe("DEPOSIT");

    expect(
      response.body.data.transaction.status,
    ).toBe("PENDING");

    expect(
      response.body.data.transaction.destinationAccountId,
    ).toBe(account.id);

    expect(
      response.body.data.ledgerEntry,
    ).toBeDefined();

    expect(
      response.body.data.ledgerEntry.entryType,
    ).toBe("CREDIT");

    const balance =
      await prisma.accountBalance.findUnique({
        where: {
          accountId_currencyCode: {
            accountId: account.id,
            currencyCode: "BDT",
          },
        },
      });

    expect(balance).not.toBeNull();

    if (!balance) {
      throw new Error(
        "Expected account balance was not found",
      );
    }

    expect(
      balance.availableBalance.eq(
        new Prisma.Decimal("10500.00"),
      ),
    ).toBe(true);

    expect(
      balance.lockedBalance.eq(
        new Prisma.Decimal("0"),
      ),
    ).toBe(true);

    const transactions =
      await prisma.transaction.findMany({
        where: {
          destinationAccountId: account.id,
          type: "DEPOSIT",
        },
      });

    expect(transactions).toHaveLength(1);

    const transaction = transactions[0];

    if (!transaction) {
      throw new Error(
        "Expected deposit transaction was not found",
      );
    }

    expect(transaction.amount.eq(
      new Prisma.Decimal("500.00"),
    )).toBe(true);

    expect(transaction.currencyCode).toBe("BDT");
    expect(transaction.status).toBe("PENDING");

    const ledgerEntries =
      await prisma.ledgerEntry.findMany({
        where: {
          accountId: account.id,
          transactionId: transaction.id,
        },
      });

    expect(ledgerEntries).toHaveLength(1);

    const ledgerEntry = ledgerEntries[0];

    if (!ledgerEntry) {
      throw new Error(
        "Expected ledger entry was not found",
      );
    }

    expect(ledgerEntry.entryType).toBe("CREDIT");

    expect(
      ledgerEntry.amount.eq(
        new Prisma.Decimal("500.00"),
      ),
    ).toBe(true);

    expect(
      ledgerEntry.balanceBefore.eq(
        new Prisma.Decimal("10000.00"),
      ),
    ).toBe(true);

    expect(
      ledgerEntry.balanceAfter.eq(
        new Prisma.Decimal("10500.00"),
      ),
    ).toBe(true);

    const auditLogs =
      await prisma.auditLog.findMany({
        where: {
          userId: user.id,
          action: "DEPOSIT_CREATED",
          entityId: transaction.id,
        },
      });

    expect(auditLogs).toHaveLength(1);
  });
});