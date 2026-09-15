import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";

const createdAccountIds: string[] = [];
const createdUserIds: string[] = [];

const createTestUser = async (
  role: "CUSTOMER" | "SUPPORT",
) => {
  const user = await prisma.user.create({
    data: {
      name: `Support Ownership ${role} ${crypto.randomUUID()}`,
      email: `support-ownership-${role.toLowerCase()}-${crypto.randomUUID()}@example.com`,
      phone: null,
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
      accountNumber: `SUP-${Date.now()}-${Math.floor(
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
    const ids = [...createdAccountIds];
    createdAccountIds.length = 0;

    await prisma.account.deleteMany({
      where: {
        id: {
          in: ids,
        },
      },
    });
  }

  if (createdUserIds.length > 0) {
    const ids = [...createdUserIds];
    createdUserIds.length = 0;

    await prisma.user.deleteMany({
      where: {
        id: {
          in: ids,
        },
      },
    });
  }
});

describe("9.7.3 SUPPORT + Ownership Boundary", () => {
  it("should allow SUPPORT to access another customer's resource through the support policy", async () => {
    const support = await createTestUser("SUPPORT");
    const customer = await createTestUser("CUSTOMER");

    const customerAccount = await createTestAccount(
      customer.id,
    );

    /*
     * The SUPPORT user does not own this account.
     * Access is granted because SUPPORT has the required
     * role and support permission.
     */
    const accessToken = createAccessToken(support);

    const response = await request(app)
      .get(
        `/api/v1/support/customers/accounts/${customerAccount.id}`,
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
  });

  it("should keep CUSTOMER ownership restrictions enforced", async () => {
    const customerA = await createTestUser("CUSTOMER");
    const customerB = await createTestUser("CUSTOMER");

    const customerBAccount = await createTestAccount(
      customerB.id,
    );

    /*
     * CUSTOMER A does not own CUSTOMER B's account.
     * The normal CUSTOMER resource boundary must reject it.
     */
    const accessToken = createAccessToken(customerA);

    const response = await request(app)
      .post(
        `/api/v1/transactions/deposit/${customerBAccount.id}`,
      )
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });
});