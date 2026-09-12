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

const createUser = async (
  role: "CUSTOMER" | "ADMIN" | "SUPPORT" | "AUDITOR",
) => {
  const user = await prisma.user.create({
    data: {
      name: `FX Test ${role}`,
      email: `fx-${role.toLowerCase()}-${crypto.randomUUID()}@example.com`,
      passwordHash: "test-password-hash",
      role,
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
      accountNumber: `FX${Date.now()}${Math.floor(Math.random() * 1000000)}`,
      accountType: "SAVINGS",
      status: "ACTIVE",
    },
  });

  createdAccountIds.push(account.id);

  return account;
};

const createFxRequest = async (userId: string, accountId: string) => {
  const fxRequest = await prisma.foreignCurrencyRequest.create({
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
  role: string,
  status = "ACTIVE",
) => {
  return jwt.sign(
    {
      sub: userId,
      email,
      role,
      status,
      tokenType: "access",
    },
    env.jwtAccessSecret,
    {
      expiresIn: "15m",
    },
  );
};

const createRefreshToken = (userId: string) => {
  return jwt.sign(
    {
      sub: userId,
      tokenType: "refresh",
      jti: crypto.randomUUID(),
    },
    env.jwtRefreshSecret,
    {
      expiresIn: "7d",
    },
  );
};

describe("Own FX Request Authorization", () => {
  afterEach(async () => {
    if (createdFxRequestIds.length > 0) {
      await prisma.foreignCurrencyRequest.deleteMany({
        where: {
          id: {
            in: createdFxRequestIds,
          },
        },
      });
    }

    if (createdAccountIds.length > 0) {
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

    createdFxRequestIds.length = 0;
    createdAccountIds.length = 0;
    createdUserIds.length = 0;
  });

  it("should allow CUSTOMER to view their own FX request", async () => {
    const customer = await createUser("CUSTOMER");
    const account = await createAccount(customer.id);
    const fxRequest = await createFxRequest(customer.id, account.id);

    const token = createAccessToken(
      customer.id,
      customer.email,
      customer.role,
      customer.status,
    );

    const response = await request(app)
      .get(`/api/v1/fx-requests/${fxRequest.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.fxRequest.id).toBe(fxRequest.id);
  });

  it("should reject CUSTOMER from viewing another customer's FX request", async () => {
    const customerOne = await createUser("CUSTOMER");
    const customerTwo = await createUser("CUSTOMER");

    const account = await createAccount(customerTwo.id);
    const fxRequest = await createFxRequest(customerTwo.id, account.id);

    const token = createAccessToken(
      customerOne.id,
      customerOne.email,
      customerOne.role,
      customerOne.status,
    );

    const response = await request(app)
      .get(`/api/v1/fx-requests/${fxRequest.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should allow ADMIN to view any FX request", async () => {
    const customer = await createUser("CUSTOMER");
    const admin = await createUser("ADMIN");

    const account = await createAccount(customer.id);
    const fxRequest = await createFxRequest(customer.id, account.id);

    const token = createAccessToken(
      admin.id,
      admin.email,
      admin.role,
      admin.status,
    );

    const response = await request(app)
      .get(`/api/v1/fx-requests/${fxRequest.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.fxRequest.id).toBe(fxRequest.id);
  });

  it("should allow SUPPORT to view an FX request", async () => {
    const customer = await createUser("CUSTOMER");
    const support = await createUser("SUPPORT");

    const account = await createAccount(customer.id);
    const fxRequest = await createFxRequest(customer.id, account.id);

    const token = createAccessToken(
      support.id,
      support.email,
      support.role,
      support.status,
    );

    const response = await request(app)
      .get(`/api/v1/fx-requests/${fxRequest.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.fxRequest.id).toBe(fxRequest.id);
  });

  it("should allow AUDITOR to view an FX request", async () => {
    const customer = await createUser("CUSTOMER");
    const auditor = await createUser("AUDITOR");

    const account = await createAccount(customer.id);
    const fxRequest = await createFxRequest(customer.id, account.id);

    const token = createAccessToken(
      auditor.id,
      auditor.email,
      auditor.role,
      auditor.status,
    );

    const response = await request(app)
      .get(`/api/v1/fx-requests/${fxRequest.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.fxRequest.id).toBe(fxRequest.id);
  });

  it("should return 404 when FX request does not exist", async () => {
    const customer = await createUser("CUSTOMER");

    const token = createAccessToken(
      customer.id,
      customer.email,
      customer.role,
      customer.status,
    );

    const missingRequestId = "00000000-0000-0000-0000-000000000000";

    const response = await request(app)
      .get(`/api/v1/fx-requests/${missingRequestId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("should reject unauthenticated access", async () => {
    const missingRequestId = "00000000-0000-0000-0000-000000000000";

    const response = await request(app).get(
      `/api/v1/fx-requests/${missingRequestId}`,
    );

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject a refresh token on the FX request route", async () => {
    const customer = await createUser("CUSTOMER");

    const refreshToken = createRefreshToken(customer.id);

    const response = await request(app)
      .get(
        "/api/v1/fx-requests/00000000-0000-0000-0000-000000000000",
      )
      .set("Authorization", `Bearer ${refreshToken}`);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should not expose sensitive authentication data", async () => {
  const customer = await createUser("CUSTOMER");
  const account = await createAccount(customer.id);
  const fxRequest = await createFxRequest(customer.id, account.id);

  const token = createAccessToken(
    customer.id,
    customer.email,
    customer.role,
    customer.status,
  );

  const response = await request(app)
    .get(`/api/v1/fx-requests/${fxRequest.id}`)
    .set("Authorization", `Bearer ${token}`);

  expect(response.status).toBe(200);

  expect(response.body).not.toHaveProperty("password");
  expect(response.body).not.toHaveProperty("passwordHash");
  expect(response.body).not.toHaveProperty("accessToken");
  expect(response.body).not.toHaveProperty("refreshToken");

  expect(response.body.data.fxRequest).not.toHaveProperty("password");
  expect(response.body.data.fxRequest).not.toHaveProperty("passwordHash");
  expect(response.body.data.fxRequest).not.toHaveProperty("accessToken");
  expect(response.body.data.fxRequest).not.toHaveProperty("refreshToken");
});

  it("should include requestId for an authorized FX request", async () => {
    const customer = await createUser("CUSTOMER");
    const account = await createAccount(customer.id);
    const fxRequest = await createFxRequest(customer.id, account.id);

    const token = createAccessToken(
      customer.id,
      customer.email,
      customer.role,
      customer.status,
    );

    const response = await request(app)
      .get(`/api/v1/fx-requests/${fxRequest.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.requestId).toBeDefined();
    expect(typeof response.body.requestId).toBe("string");
  });
});