import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";

const createdUserIds: string[] = [];
const createdAccountIds: string[] = [];

const createTestUser = async (
  role: "CUSTOMER" | "ADMIN",
) => {
  const user = await prisma.user.create({
    data: {
      name: `Admin Ownership Test ${Date.now()}-${Math.random()}`,
      email: `admin-ownership-${Date.now()}-${Math.random()}@example.com`,
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
      accountNumber: `10${Date.now()}${Math.floor(
        100000 + Math.random() * 900000,
      )}`,
      accountType: "SAVINGS",
      status: "ACTIVE",
    },
  });

  createdAccountIds.push(account.id);

  return account;
};

const createAccessToken = (user: {
  id: string;
  email: string;
  role: string;
  status: string;
}) => {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      tokenType: "access",
    },
    env.jwtAccessSecret,
    {
      expiresIn: "15m",
    },
  );
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

describe("9.7.2 ADMIN + Ownership Boundary", () => {
  it("should allow ADMIN to access another customer's account", async () => {
    const admin = await createTestUser("ADMIN");
    const customer = await createTestUser("CUSTOMER");

    const customerAccount = await createTestAccount(
      customer.id,
    );

    const accessToken = createAccessToken(admin);

    const response = await request(app)
      .get(
        `/api/v1/admin/accounts/${customerAccount.id}`,
      )
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(response.body.data.account.id).toBe(
      customerAccount.id,
    );

    expect(response.body.data.account.userId).toBe(
      customer.id,
    );

    expect(response.body.data.account.user.id).toBe(
      customer.id,
    );
  });

  it("should deny CUSTOMER even when requesting another customer's account through the ADMIN route", async () => {
    const customerA = await createTestUser("CUSTOMER");
    const customerB = await createTestUser("CUSTOMER");

    const customerBAccount = await createTestAccount(
      customerB.id,
    );

    const accessToken = createAccessToken(customerA);

    const response = await request(app)
      .get(
        `/api/v1/admin/accounts/${customerBAccount.id}`,
      )
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });
});