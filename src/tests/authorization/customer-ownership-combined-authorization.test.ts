import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { generateAccessToken } from "../../auth/utils/jwt";

const createdAccountIds: string[] = [];
const createdUserIds: string[] = [];

const createCustomer = async (
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

const createAccount = async (userId: string) => {
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

describe("9.7.1 CUSTOMER + Ownership", () => {
  it("should allow CUSTOMER with ownership over the resource", async () => {
    const customer = await createCustomer(
      "Combined Authorization Owner",
      `combined-owner-${Date.now()}@example.com`,
    );

    const account = await createAccount(customer.id);

    const accessToken = createCustomerAccessToken(
      customer.id,
      customer.email,
    );

    const response = await request(app)
      .post(`/api/v1/transactions/deposit/${account.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(response.body.data.accountId).toBe(account.id);
    expect(response.body.data.userId).toBe(customer.id);
    expect(response.body.data.userRole).toBe("CUSTOMER");
  });

  it("should deny CUSTOMER without ownership over the resource", async () => {
    const customerA = await createCustomer(
      "Combined Authorization Customer A",
      `combined-a-${Date.now()}@example.com`,
    );

    const customerB = await createCustomer(
      "Combined Authorization Customer B",
      `combined-b-${Date.now()}@example.com`,
    );

    const accountB = await createAccount(customerB.id);

    const accessToken = createCustomerAccessToken(
      customerA.id,
      customerA.email,
    );

    const response = await request(app)
      .post(`/api/v1/transactions/deposit/${accountB.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });
});