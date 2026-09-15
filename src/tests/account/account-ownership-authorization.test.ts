import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { generateAccessToken } from "../../auth/utils/jwt";

const createdAccountIds: string[] = [];
const createdUserIds: string[] = [];

const createTestUser = async (
  name: string,
  email: string,
  role: "CUSTOMER" | "ADMIN" | "SUPPORT" | "AUDITOR" = "CUSTOMER",
) => {
  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: "test-password-hash",
      role,
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

describe("9.6.1 Account Ownership Authorization", () => {
  it("should allow CUSTOMER to access their own account", async () => {
    const customer = await createTestUser(
      "Ownership Customer",
      `ownership-customer-${Date.now()}-${Math.random()}@example.com`,
    );

    const account = await createTestAccount(customer.id);

    const accessToken = generateAccessToken({
      id: customer.id,
      email: customer.email,
      role: customer.role,
      status: customer.status,
    });

    const response = await request(app)
      .post(`/api/v1/transactions/deposit/${account.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(response.body.data.accountId).toBe(account.id);
    expect(response.body.data.accountNumber).toBe(account.accountNumber);
    expect(response.body.data.userId).toBe(customer.id);
    expect(response.body.data.userRole).toBe("CUSTOMER");
  });

  it("should deny CUSTOMER access to another customer's account", async () => {
    const customerA = await createTestUser(
      "Ownership Customer A",
      `ownership-customer-a-${Date.now()}-${Math.random()}@example.com`,
    );

    const customerB = await createTestUser(
      "Ownership Customer B",
      `ownership-customer-b-${Date.now()}-${Math.random()}@example.com`,
    );

    const accountB = await createTestAccount(customerB.id);

    const accessToken = generateAccessToken({
      id: customerA.id,
      email: customerA.email,
      role: customerA.role,
      status: customerA.status,
    });

    const response = await request(app)
      .post(`/api/v1/transactions/deposit/${accountB.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });
});