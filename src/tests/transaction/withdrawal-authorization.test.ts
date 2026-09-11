import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { generateAccessToken } from "../../auth/utils/jwt";

describe("Withdrawal Authorization", () => {
  beforeEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.emailVerificationOtp.deleteMany();
    await prisma.account.deleteMany();
    await prisma.user.deleteMany();
  });

  const createAccessToken = (
    id: string,
    email: string,
    role: string,
  ) =>
    generateAccessToken({
      id,
      email,
      role,
      status: "ACTIVE",
    });

  const createUser = async (
    name: string,
    email: string,
    role: "CUSTOMER" | "ADMIN" | "SUPPORT" | "AUDITOR",
  ) => {
    return prisma.user.create({
      data: {
        name,
        email,
        passwordHash: "test-password-hash",
        role,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });
  };

  const createAccount = async (userId: string) => {
    return prisma.account.create({
      data: {
        userId,
        accountNumber: `ACC-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
        accountType: "SAVINGS",
        status: "ACTIVE",
      },
    });
  };

  it("should allow CUSTOMER to withdraw from their own account", async () => {
    const customer = await createUser(
      "Customer One",
      "customer-one@example.com",
      "CUSTOMER",
    );

    const account = await createAccount(customer.id);

    const accessToken = createAccessToken(
      customer.id,
      customer.email,
      "CUSTOMER",
    );

    const response = await request(app)
      .post(`/api/v1/transactions/withdrawal/${account.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.accountId).toBe(account.id);
    expect(response.body.data.userId).toBe(customer.id);
    expect(response.body.data.userRole).toBe("CUSTOMER");
  });

  it("should reject CUSTOMER from withdrawing from another customer's account", async () => {
    const customerA = await createUser(
      "Customer A",
      "customer-a@example.com",
      "CUSTOMER",
    );

    const customerB = await createUser(
      "Customer B",
      "customer-b@example.com",
      "CUSTOMER",
    );

    const accountB = await createAccount(customerB.id);

    const accessToken = createAccessToken(
      customerA.id,
      customerA.email,
      "CUSTOMER",
    );

    const response = await request(app)
      .post(`/api/v1/transactions/withdrawal/${accountB.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should allow ADMIN to withdraw from any account", async () => {
    const admin = await createUser(
      "Admin User",
      "admin@example.com",
      "ADMIN",
    );

    const customer = await createUser(
      "Customer User",
      "customer@example.com",
      "CUSTOMER",
    );

    const customerAccount = await createAccount(customer.id);

    const accessToken = createAccessToken(
      admin.id,
      admin.email,
      "ADMIN",
    );

    const response = await request(app)
      .post(`/api/v1/transactions/withdrawal/${customerAccount.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.accountId).toBe(customerAccount.id);
    expect(response.body.data.userId).toBe(admin.id);
    expect(response.body.data.userRole).toBe("ADMIN");
  });

  it("should reject SUPPORT from performing a withdrawal", async () => {
    const support = await createUser(
      "Support User",
      "support@example.com",
      "SUPPORT",
    );

    const customer = await createUser(
      "Customer User",
      "customer@example.com",
      "CUSTOMER",
    );

    const account = await createAccount(customer.id);

    const accessToken = createAccessToken(
      support.id,
      support.email,
      "SUPPORT",
    );

    const response = await request(app)
      .post(`/api/v1/transactions/withdrawal/${account.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject AUDITOR from performing a withdrawal", async () => {
    const auditor = await createUser(
      "Auditor User",
      "auditor@example.com",
      "AUDITOR",
    );

    const customer = await createUser(
      "Customer User",
      "customer@example.com",
      "CUSTOMER",
    );

    const account = await createAccount(customer.id);

    const accessToken = createAccessToken(
      auditor.id,
      auditor.email,
      "AUDITOR",
    );

    const response = await request(app)
      .post(`/api/v1/transactions/withdrawal/${account.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject withdrawal when the account does not exist", async () => {
    const customer = await createUser(
      "Customer User",
      "withdrawal-not-found@example.com",
      "CUSTOMER",
    );

    const accessToken = createAccessToken(
      customer.id,
      customer.email,
      "CUSTOMER",
    );

    const response = await request(app)
      .post(
        "/api/v1/transactions/withdrawal/00000000-0000-0000-0000-000000000000",
      )
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("should reject withdrawal when authentication is missing", async () => {
    const response = await request(app).post(
      "/api/v1/transactions/withdrawal/00000000-0000-0000-0000-000000000000",
    );

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject a refresh token from the withdrawal route", async () => {
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
        "/api/v1/transactions/withdrawal/00000000-0000-0000-0000-000000000000",
      )
      .set("Authorization", `Bearer ${refreshToken}`);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should not modify account balance during authorization", async () => {
    const customer = await createUser(
      "Customer Balance",
      "customer-withdrawal-balance@example.com",
      "CUSTOMER",
    );

    const account = await createAccount(customer.id);

    const accessToken = createAccessToken(
      customer.id,
      customer.email,
      "CUSTOMER",
    );

    const response = await request(app)
      .post(`/api/v1/transactions/withdrawal/${account.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);

    const accountBalanceCount = await prisma.accountBalance.count({
      where: {
        accountId: account.id,
      },
    });

    const transactionCount = await prisma.transaction.count({
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
      "customer-withdrawal-request-id@example.com",
      "CUSTOMER",
    );

    const account = await createAccount(customer.id);

    const accessToken = createAccessToken(
      customer.id,
      customer.email,
      "CUSTOMER",
    );

    const response = await request(app)
      .post(`/api/v1/transactions/withdrawal/${account.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.requestId).toEqual(expect.any(String));
  });
});