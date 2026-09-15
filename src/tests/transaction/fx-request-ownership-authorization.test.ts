import { describe, expect, it, afterEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";

const createdUserIds: string[] = [];
const createdAccountIds: string[] = [];
const createdFxRequestIds: string[] = [];

const TEST_CURRENCY = "USD";

const createCustomer = async () => {
  const user = await prisma.user.create({
    data: {
      name: "FX Ownership Customer",
      email: `fx-ownership-${crypto.randomUUID()}@example.com`,
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
      accountNumber: `FX${Date.now()}${Math.floor(
        Math.random() * 1000000,
      )}`,
      accountType: "SAVINGS",
      status: "ACTIVE",
    },
  });

  createdAccountIds.push(account.id);

  return account;
};

const createFxRequest = async (
  userId: string,
  accountId: string,
) => {
  const fxRequest =
    await prisma.foreignCurrencyRequest.create({
      data: {
        userId,
        accountId,
        requestedCurrency: TEST_CURRENCY,
        requestedAmount: 1000,
        purposeCategory: "Education",
        purposeDescription: "Test foreign currency request",
        supportingReference: "TEST-REF",
        status: "PENDING",
      },
    });

  createdFxRequestIds.push(fxRequest.id);

  return fxRequest;
};

const createAccessToken = (
  userId: string,
  email: string,
) => {
  return jwt.sign(
    {
      sub: userId,
      email,
      role: "CUSTOMER",
      status: "ACTIVE",
      tokenType: "access",
    },
    env.jwtAccessSecret,
    {
      expiresIn: "15m",
    },
  );
};

describe("9.6.4 FX Request Ownership Authorization", () => {
  afterEach(async () => {
    if (createdFxRequestIds.length > 0) {
      await prisma.foreignCurrencyRequest.deleteMany({
        where: {
          id: {
            in: createdFxRequestIds,
          },
        },
      });

      createdFxRequestIds.length = 0;
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

  it("should allow CUSTOMER to access their own FX request", async () => {
    const customer = await createCustomer();

    const account = await createAccount(customer.id);

    const fxRequest = await createFxRequest(
      customer.id,
      account.id,
    );

    const accessToken = createAccessToken(
      customer.id,
      customer.email,
    );

    const response = await request(app)
      .get(`/api/v1/fx-requests/${fxRequest.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(response.body.data.fxRequest.id).toBe(
      fxRequest.id,
    );

    expect(response.body.data.fxRequest.userId).toBe(
      customer.id,
    );
  });

  it("should deny CUSTOMER access to another customer's FX request", async () => {
    const customerA = await createCustomer();
    const customerB = await createCustomer();

    const accountB = await createAccount(customerB.id);

    const fxRequestB = await createFxRequest(
      customerB.id,
      accountB.id,
    );

    const accessToken = createAccessToken(
      customerA.id,
      customerA.email,
    );

    const response = await request(app)
      .get(`/api/v1/fx-requests/${fxRequestB.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });
});