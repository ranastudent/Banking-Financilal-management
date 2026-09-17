import request from "supertest";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { generateAccessToken } from "../../auth/utils/jwt";
import { env } from "../../config/env";

describe("Deposit Authorization", () => {
  const createdUserIds: string[] = [];
  const createdAccountIds: string[] = [];

  beforeEach(() => {
    createdUserIds.length = 0;
    createdAccountIds.length = 0;
  });

  afterEach(async () => {
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

      createdAccountIds.length = 0;
    }

    if (createdUserIds.length > 0) {
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

      await prisma.auditLog.deleteMany({
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

  const createAccessToken = (
    id: string,
    email: string,
    role: "CUSTOMER" | "ADMIN" | "SUPPORT" | "AUDITOR",
  ) => {
    return generateAccessToken({
      id,
      email,
      role,
      status: "ACTIVE",
    });
  };

  const createUser = async (
    name: string,
    email: string,
    role: "CUSTOMER" | "ADMIN" | "SUPPORT" | "AUDITOR",
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

  it("should allow CUSTOMER to deposit into their own account", async () => {
    const customer = await createUser(
      "Customer One",
      `customer-one-${Date.now()}-${Math.random()}@example.com`,
      "CUSTOMER",
    );

    const account = await createAccount(customer.id);

    const accessToken = createAccessToken(
      customer.id,
      customer.email,
      "CUSTOMER",
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

  it("should reject CUSTOMER from depositing into another customer's account", async () => {
    const customerA = await createUser(
      "Customer A",
      `customer-a-${Date.now()}-${Math.random()}@example.com`,
      "CUSTOMER",
    );

    const customerB = await createUser(
      "Customer B",
      `customer-b-${Date.now()}-${Math.random()}@example.com`,
      "CUSTOMER",
    );

    const accountB = await createAccount(customerB.id);

    const accessToken = createAccessToken(
      customerA.id,
      customerA.email,
      "CUSTOMER",
    );

    const response = await request(app)
      .post(`/api/v1/transactions/deposit/${accountB.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should allow ADMIN to deposit into any account", async () => {
    const admin = await createUser(
      "Admin User",
      `admin-${Date.now()}-${Math.random()}@example.com`,
      "ADMIN",
    );

    const customer = await createUser(
      "Customer User",
      `customer-${Date.now()}-${Math.random()}@example.com`,
      "CUSTOMER",
    );

    const customerAccount = await createAccount(
      customer.id,
    );

    const accessToken = createAccessToken(
      admin.id,
      admin.email,
      "ADMIN",
    );

    const response = await request(app)
      .post(
        `/api/v1/transactions/deposit/${customerAccount.id}`,
      )
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.accountId).toBe(
      customerAccount.id,
    );
    expect(response.body.data.userId).toBe(admin.id);
    expect(response.body.data.userRole).toBe("ADMIN");
  });

  it("should reject SUPPORT from performing a deposit", async () => {
    const support = await createUser(
      "Support User",
      `support-${Date.now()}-${Math.random()}@example.com`,
      "SUPPORT",
    );

    const customer = await createUser(
      "Customer User",
      `customer-${Date.now()}-${Math.random()}@example.com`,
      "CUSTOMER",
    );

    const account = await createAccount(customer.id);

    const accessToken = createAccessToken(
      support.id,
      support.email,
      "SUPPORT",
    );

    const response = await request(app)
      .post(`/api/v1/transactions/deposit/${account.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject AUDITOR from performing a deposit", async () => {
    const auditor = await createUser(
      "Auditor User",
      `auditor-${Date.now()}-${Math.random()}@example.com`,
      "AUDITOR",
    );

    const customer = await createUser(
      "Customer User",
      `customer-${Date.now()}-${Math.random()}@example.com`,
      "CUSTOMER",
    );

    const account = await createAccount(customer.id);

    const accessToken = createAccessToken(
      auditor.id,
      auditor.email,
      "AUDITOR",
    );

    const response = await request(app)
      .post(`/api/v1/transactions/deposit/${account.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject deposit when the account does not exist", async () => {
    const customer = await createUser(
      "Customer User",
      `customer-not-found-${Date.now()}-${Math.random()}@example.com`,
      "CUSTOMER",
    );

    const accessToken = createAccessToken(
      customer.id,
      customer.email,
      "CUSTOMER",
    );

    const response = await request(app)
      .post(
        "/api/v1/transactions/deposit/00000000-0000-0000-0000-000000000000",
      )
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "RESOURCE_NOT_FOUND",
    );
  });

  it("should reject deposit when authentication is missing", async () => {
    const response = await request(app)
      .post(
        "/api/v1/transactions/deposit/00000000-0000-0000-0000-000000000000",
      );

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "UNAUTHORIZED",
    );
  });

  it("should reject a refresh token from the deposit route", async () => {
    const jwt = await import("jsonwebtoken");

    const refreshToken = jwt.sign(
      {
        sub: "customer-123",
        tokenType: "refresh",
        jti: "refresh-jti-123",
      },
      env.jwtRefreshSecret,
      {
        expiresIn: "7d",
      },
    );

    const response = await request(app)
      .post(
        "/api/v1/transactions/deposit/00000000-0000-0000-0000-000000000000",
      )
      .set(
        "Authorization",
        `Bearer ${refreshToken}`,
      );

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "UNAUTHORIZED",
    );
  });

  it("should not modify account balance during authorization", async () => {
    const customer = await createUser(
      "Customer Balance",
      `customer-balance-${Date.now()}-${Math.random()}@example.com`,
      "CUSTOMER",
    );

    const account = await createAccount(customer.id);

    const accessToken = createAccessToken(
      customer.id,
      customer.email,
      "CUSTOMER",
    );

    const response = await request(app)
      .post(`/api/v1/transactions/deposit/${account.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);

    const accountBalanceCount =
      await prisma.accountBalance.count({
        where: {
          accountId: account.id,
        },
      });

    const transactionCount =
      await prisma.transaction.count({
        where: {
          sourceAccountId: account.id,
        },
      });

    expect(accountBalanceCount).toBe(0);
    expect(transactionCount).toBe(0);
  });

  it("should return requestId for a successful authorization", async () => {
    const customer = await createUser(
      "Customer Request ID",
      `customer-request-id-${Date.now()}-${Math.random()}@example.com`,
      "CUSTOMER",
    );

    const account = await createAccount(customer.id);

    const accessToken = createAccessToken(
      customer.id,
      customer.email,
      "CUSTOMER",
    );

    const response = await request(app)
      .post(`/api/v1/transactions/deposit/${account.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.requestId).toEqual(
      expect.any(String),
    );
  });
});