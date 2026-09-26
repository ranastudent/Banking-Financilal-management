import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "../../config/prisma";
import  app  from "../../app";
import { generateAccessToken } from "../../auth/utils/jwt";

const createdUserIds: string[] = [];
const createdAccountIds: string[] = [];
const createdTransactionIds: string[] = [];

afterEach(async () => {
  if (createdAccountIds.length > 0) {
    const relatedTransactions = await prisma.transaction.findMany({
      where: {
        OR: [
          { sourceAccountId: { in: createdAccountIds } },
          { destinationAccountId: { in: createdAccountIds } },
        ],
      },
      select: { id: true },
    });

    for (const transaction of relatedTransactions) {
      if (!createdTransactionIds.includes(transaction.id)) {
        createdTransactionIds.push(transaction.id);
      }
    }
  }

  if (createdTransactionIds.length > 0) {
    await prisma.ledgerEntry.deleteMany({
      where: {
        transactionId: {
          in: createdTransactionIds,
        },
      },
    });
  }

  if (createdAccountIds.length > 0) {
    await prisma.transactionLeg.deleteMany({
      where: {
        accountId: {
          in: createdAccountIds,
        },
      },
    });
  }

  if (createdTransactionIds.length > 0) {
    await prisma.transaction.deleteMany({
      where: {
        id: {
          in: createdTransactionIds,
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

  createdTransactionIds.length = 0;
  createdAccountIds.length = 0;
  createdUserIds.length = 0;
});

async function createUser() {
  const user = await prisma.user.create({
    data: {
      name: `Transfer Normalization User ${Date.now()}-${Math.random()}`,
      email: `transfer-normalization-${Date.now()}-${Math.random()}@example.com`,
      passwordHash: "test-password-hash",
      role: "CUSTOMER",
      status: "ACTIVE",
    },
  });

  createdUserIds.push(user.id);

  return user;
}

async function createAccount(userId: string, accountNumber: string) {
  const account = await prisma.account.create({
    data: {
      userId,
      accountNumber,
      accountType: "SAVINGS",
      status: "ACTIVE",
    },
  });

  createdAccountIds.push(account.id);

  return account;
}

function createAccessToken(user: {
  id: string;
  email: string;
  role:
    | "CUSTOMER"
    | "ADMIN"
    | "SUPPORT"
    | "AUDITOR";
}) {
  return generateAccessToken({
    id: user.id,
    email: user.email,
    role: user.role,
    status: "ACTIVE",
  });
}

async function createBdtBalance(accountId: string, amount: string) {
  return prisma.accountBalance.create({
    data: {
      accountId,
      currencyCode: "BDT",
      availableBalance: amount,
      lockedBalance: "0",
    },
  });
}

async function createUsdBalance(accountId: string, amount: string) {
  return prisma.accountBalance.create({
    data: {
      accountId,
      currencyCode: "USD",
      availableBalance: amount,
      lockedBalance: "0",
    },
  });
}

function createIdempotencyKey() {
  return crypto.randomUUID();
}

describe("14.7.6 Currency Normalization", () => {
  it("should normalize lowercase bdt to BDT", async () => {
    const user = await createUser();

    const sender = await createAccount(
      user.id,
      `ACC-${Date.now()}-NORM-BDT-S`,
    );

    const receiverUser = await createUser();

    const receiver = await createAccount(
      receiverUser.id,
      `ACC-${Date.now()}-NORM-BDT-R`,
    );

    await createBdtBalance(sender.id, "10000");
    await createBdtBalance(receiver.id, "5000");

    const token = createAccessToken(user);

    const response = await request(app)
      .post("/api/v1/transfers")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", createIdempotencyKey())
      .send({
        senderAccount: sender.accountNumber,
        receiverAccount: receiver.accountNumber,
        amount: "1000",
        currency: "bdt",
      });

    expect(response.status).toBe(200);

    const transaction = await prisma.transaction.findFirst({
      where: {
        sourceAccountId: sender.id,
        destinationAccountId: receiver.id,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    expect(transaction).not.toBeNull();
    expect(transaction?.currencyCode).toBe("BDT");

    if (transaction) {
      createdTransactionIds.push(transaction.id);
    }
  });

  it("should normalize lowercase usd to USD", async () => {
    const user = await createUser();

    const sender = await createAccount(
      user.id,
      `ACC-${Date.now()}-NORM-USD-S`,
    );

    const receiverUser = await createUser();

    const receiver = await createAccount(
      receiverUser.id,
      `ACC-${Date.now()}-NORM-USD-R`,
    );

    await createUsdBalance(sender.id, "1000");
    await createUsdBalance(receiver.id, "500");

    const token = createAccessToken(user);

    const response = await request(app)
      .post("/api/v1/transfers")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", createIdempotencyKey())
      .send({
        senderAccount: sender.accountNumber,
        receiverAccount: receiver.accountNumber,
        amount: "100",
        currency: "usd",
      });

    expect(response.status).toBe(200);

    const transaction = await prisma.transaction.findFirst({
      where: {
        sourceAccountId: sender.id,
        destinationAccountId: receiver.id,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    expect(transaction).not.toBeNull();
    expect(transaction?.currencyCode).toBe("USD");

    if (transaction) {
      createdTransactionIds.push(transaction.id);
    }
  });

  it("should trim whitespace around the currency code", async () => {
    const user = await createUser();

    const sender = await createAccount(
      user.id,
      `ACC-${Date.now()}-NORM-SPACE-S`,
    );

    const receiverUser = await createUser();

    const receiver = await createAccount(
      receiverUser.id,
      `ACC-${Date.now()}-NORM-SPACE-R`,
    );

    await createBdtBalance(sender.id, "10000");
    await createBdtBalance(receiver.id, "5000");

    const token = createAccessToken(user);

    const response = await request(app)
      .post("/api/v1/transfers")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", createIdempotencyKey())
      .send({
        senderAccount: sender.accountNumber,
        receiverAccount: receiver.accountNumber,
        amount: "1000",
        currency: "  bdt  ",
      });

    expect(response.status).toBe(200);

    const transaction = await prisma.transaction.findFirst({
      where: {
        sourceAccountId: sender.id,
        destinationAccountId: receiver.id,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    expect(transaction).not.toBeNull();
    expect(transaction?.currencyCode).toBe("BDT");

    if (transaction) {
      createdTransactionIds.push(transaction.id);
    }
  });
});