import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { generateAccessToken } from "../../auth/utils/jwt";

const createdTransactionIds: string[] = [];
const createdAccountIds: string[] = [];
const createdUserIds: string[] = [];

const createTestUser = async (
  name: string,
  email: string,
) => {
  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: "test-password-hash",
      role: "CUSTOMER",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });

  createdUserIds.push(user.id);

  return user;
};

const createTestAccount = async (userId: string) => {
  const account = await prisma.account.create({
    data: {
      userId,
      accountNumber: `ACC-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      accountType: "SAVINGS",
      status: "ACTIVE",
    },
  });

  createdAccountIds.push(account.id);

  return account;
};

const createTestTransaction = async ({
  sourceAccountId,
  destinationAccountId,
}: {
  sourceAccountId?: string;
  destinationAccountId?: string;
}) => {
  const transaction = await prisma.transaction.create({
    data: {
      reference: `TX-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      type: "INTERNAL_TRANSFER",
      status: "COMPLETED",
      amount: "100.00",
      currencyCode: "BDT",
      provider: "INTERNAL",

      ...(sourceAccountId !== undefined && {
        sourceAccountId,
      }),

      ...(destinationAccountId !== undefined && {
        destinationAccountId,
      }),
    },
  });

  createdTransactionIds.push(transaction.id);

  return transaction;
};

const createCustomerAccessToken = (
  userId: string,
  email: string,
) =>
  generateAccessToken({
    id: userId,
    email,
    role: "CUSTOMER",
    status: "ACTIVE",
  });

afterEach(async () => {
  if (createdTransactionIds.length > 0) {
    await prisma.transaction.deleteMany({
      where: {
        id: {
          in: createdTransactionIds,
        },
      },
    });

    createdTransactionIds.length = 0;
  }

  if (createdAccountIds.length > 0) {
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

describe("9.6.2 Transaction Ownership Authorization", () => {
  it("should allow CUSTOMER when they own the source account", async () => {
    const customer = await createTestUser(
      "Transaction Source Owner",
      `transaction-source-${Date.now()}-${Math.random()}@example.com`,
    );

    const otherCustomer = await createTestUser(
      "Transaction Destination Owner",
      `transaction-destination-${Date.now()}-${Math.random()}@example.com`,
    );

    const sourceAccount = await createTestAccount(customer.id);
    const destinationAccount = await createTestAccount(
      otherCustomer.id,
    );

    const transaction = await createTestTransaction({
      sourceAccountId: sourceAccount.id,
      destinationAccountId: destinationAccount.id,
    });

    const accessToken = createCustomerAccessToken(
      customer.id,
      customer.email,
    );

    const response = await request(app)
      .get(`/api/v1/transactions/${transaction.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.transaction.id).toBe(transaction.id);
  });

  it("should allow CUSTOMER when they own the destination account", async () => {
    const sourceCustomer = await createTestUser(
      "Transaction Source Owner",
      `transaction-source-${Date.now()}-${Math.random()}@example.com`,
    );

    const customer = await createTestUser(
      "Transaction Destination Owner",
      `transaction-destination-${Date.now()}-${Math.random()}@example.com`,
    );

    const sourceAccount = await createTestAccount(
      sourceCustomer.id,
    );
    const destinationAccount = await createTestAccount(
      customer.id,
    );

    const transaction = await createTestTransaction({
      sourceAccountId: sourceAccount.id,
      destinationAccountId: destinationAccount.id,
    });

    const accessToken = createCustomerAccessToken(
      customer.id,
      customer.email,
    );

    const response = await request(app)
      .get(`/api/v1/transactions/${transaction.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.transaction.id).toBe(transaction.id);
  });

  it("should deny CUSTOMER when they own neither source nor destination account", async () => {
    const unauthorizedCustomer = await createTestUser(
      "Unauthorized Customer",
      `transaction-unauthorized-${Date.now()}-${Math.random()}@example.com`,
    );

    const sourceCustomer = await createTestUser(
      "Source Customer",
      `transaction-source-${Date.now()}-${Math.random()}@example.com`,
    );

    const destinationCustomer = await createTestUser(
      "Destination Customer",
      `transaction-destination-${Date.now()}-${Math.random()}@example.com`,
    );

    const sourceAccount = await createTestAccount(
      sourceCustomer.id,
    );
    const destinationAccount = await createTestAccount(
      destinationCustomer.id,
    );

    const transaction = await createTestTransaction({
      sourceAccountId: sourceAccount.id,
      destinationAccountId: destinationAccount.id,
    });

    const accessToken = createCustomerAccessToken(
      unauthorizedCustomer.id,
      unauthorizedCustomer.email,
    );

    const response = await request(app)
      .get(`/api/v1/transactions/${transaction.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });
});