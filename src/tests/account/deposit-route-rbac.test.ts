import request from "supertest";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import jwt from "jsonwebtoken";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { generateAccessToken } from "../../auth/utils/jwt";

describe("12.2 Deposit Route + JWT + RBAC", () => {
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

  const createUser = async (
    role: "CUSTOMER" | "ADMIN" | "SUPPORT" | "AUDITOR",
  ) => {
    const user = await prisma.user.create({
      data: {
        name: `Deposit Route ${Date.now()}`,
        email: `deposit-route-${Date.now()}-${Math.random()}@example.com`,
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

  const createAccessToken = (user: {
    id: string;
    email: string;
    role: "CUSTOMER" | "ADMIN" | "SUPPORT" | "AUDITOR";
  }) => {
    return generateAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
      status: "ACTIVE",
    });
  };

  it("should allow CUSTOMER to access the deposit route for their own account", async () => {
    const customer = await createUser("CUSTOMER");
    const account = await createAccount(customer.id);

    const accessToken = createAccessToken(customer);

    const response = await request(app)
      .post(`/api/v1/accounts/${account.id}/deposits`)
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      )
      .send({
        amount: "5000.00",
        currency: "BDT",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.accountId).toBe(
      account.id,
    );
    expect(response.body.data.userId).toBe(
      customer.id,
    );
    expect(response.body.data.userRole).toBe(
      "CUSTOMER",
    );
  });

  it("should reject CUSTOMER from depositing into another customer's account", async () => {
    const customerA = await createUser("CUSTOMER");
    const customerB = await createUser("CUSTOMER");

    const accountB = await createAccount(customerB.id);

    const accessToken = createAccessToken(customerA);

    const response = await request(app)
      .post(`/api/v1/accounts/${accountB.id}/deposits`)
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      )
      .send({
        amount: "5000.00",
        currency: "BDT",
      });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "FORBIDDEN",
    );
  });

  it("should allow ADMIN to deposit into any account", async () => {
    const admin = await createUser("ADMIN");
    const customer = await createUser("CUSTOMER");

    const account = await createAccount(customer.id);

    const accessToken = createAccessToken(admin);

    const response = await request(app)
      .post(`/api/v1/accounts/${account.id}/deposits`)
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      )
      .send({
        amount: "5000.00",
        currency: "BDT",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.accountId).toBe(
      account.id,
    );
    expect(response.body.data.userId).toBe(
      admin.id,
    );
    expect(response.body.data.userRole).toBe(
      "ADMIN",
    );
  });

  it("should reject SUPPORT", async () => {
    const support = await createUser("SUPPORT");
    const customer = await createUser("CUSTOMER");

    const account = await createAccount(customer.id);

    const accessToken = createAccessToken(support);

    const response = await request(app)
      .post(`/api/v1/accounts/${account.id}/deposits`)
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      )
      .send({
        amount: "5000.00",
        currency: "BDT",
      });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "FORBIDDEN",
    );
  });

  it("should reject AUDITOR", async () => {
    const auditor = await createUser("AUDITOR");
    const customer = await createUser("CUSTOMER");

    const account = await createAccount(customer.id);

    const accessToken = createAccessToken(auditor);

    const response = await request(app)
      .post(`/api/v1/accounts/${account.id}/deposits`)
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      )
      .send({
        amount: "5000.00",
        currency: "BDT",
      });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "FORBIDDEN",
    );
  });

  it("should reject an unauthenticated request", async () => {
    const response = await request(app)
      .post(
        "/api/v1/accounts/00000000-0000-0000-0000-000000000000/deposits",
      )
      .send({
        amount: "5000.00",
        currency: "BDT",
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "UNAUTHORIZED",
    );
  });

  it("should reject a refresh token", async () => {
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
        "/api/v1/accounts/00000000-0000-0000-0000-000000000000/deposits",
      )
      .set(
        "Authorization",
        `Bearer ${refreshToken}`,
      )
      .send({
        amount: "5000.00",
        currency: "BDT",
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "UNAUTHORIZED",
    );
  });

  it("should validate the deposit body after authentication and RBAC", async () => {
    const customer = await createUser("CUSTOMER");
    const account = await createAccount(customer.id);

    const accessToken = createAccessToken(customer);

    const response = await request(app)
      .post(`/api/v1/accounts/${account.id}/deposits`)
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      )
      .send({
        amount: "-100.00",
        currency: "BDT",
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("should reject client-provided balance fields", async () => {
    const customer = await createUser("CUSTOMER");
    const account = await createAccount(customer.id);

    const accessToken = createAccessToken(customer);

    const response = await request(app)
      .post(`/api/v1/accounts/${account.id}/deposits`)
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      )
      .send({
        amount: "5000.00",
        currency: "BDT",
        balance: "999999.00",
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("should reject an unsupported currency format", async () => {
    const customer = await createUser("CUSTOMER");
    const account = await createAccount(customer.id);

    const accessToken = createAccessToken(customer);

    const response = await request(app)
      .post(`/api/v1/accounts/${account.id}/deposits`)
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      )
      .send({
        amount: "5000.00",
        currency: "USDX",
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("should return 404 when the account does not exist", async () => {
    const customer = await createUser("CUSTOMER");

    const accessToken = createAccessToken(customer);

    const response = await request(app)
      .post(
        "/api/v1/accounts/00000000-0000-0000-0000-000000000000/deposits",
      )
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      )
      .send({
        amount: "5000.00",
        currency: "BDT",
      });

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "RESOURCE_NOT_FOUND",
    );
  });

  it("should include requestId for a successful deposit authorization", async () => {
    const customer = await createUser("CUSTOMER");
    const account = await createAccount(customer.id);

    const accessToken = createAccessToken(customer);

    const response = await request(app)
      .post(`/api/v1/accounts/${account.id}/deposits`)
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      )
      .send({
        amount: "5000.00",
        currency: "BDT",
      });

    expect(response.status).toBe(200);
    expect(response.body.requestId).toEqual(
      expect.any(String),
    );
  });
});