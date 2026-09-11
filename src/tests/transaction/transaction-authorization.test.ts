import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { generateAccessToken } from "../../auth/utils/jwt";

describe("Own Transaction Authorization", () => {
  beforeEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.emailVerificationOtp.deleteMany();
    await prisma.transactionLeg.deleteMany();
    await prisma.ledgerEntry.deleteMany();
    await prisma.transaction.deleteMany();
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

  const createTransaction = async ({
  sourceAccountId,
  destinationAccountId,
}: {
  sourceAccountId?: string;
  destinationAccountId?: string;
}) => {
  return prisma.transaction.create({
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
};

  it("should allow CUSTOMER to view a transaction involving their own source account", async () => {
    const customer = await createUser(
      "Customer One",
      "transaction-customer-one@example.com",
      "CUSTOMER",
    );

    const otherCustomer = await createUser(
      "Customer Two",
      "transaction-customer-two@example.com",
      "CUSTOMER",
    );

    const customerAccount = await createAccount(customer.id);
    const otherAccount = await createAccount(otherCustomer.id);

    const transaction = await createTransaction({
      sourceAccountId: customerAccount.id,
      destinationAccountId: otherAccount.id,
    });

    const accessToken = createAccessToken(
      customer.id,
      customer.email,
      "CUSTOMER",
    );

    const response = await request(app)
      .get(`/api/v1/transactions/${transaction.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.transaction.id).toBe(transaction.id);
  });

  it("should allow CUSTOMER to view a transaction involving their own destination account", async () => {
    const customer = await createUser(
      "Destination Customer",
      "transaction-destination-customer@example.com",
      "CUSTOMER",
    );

    const otherCustomer = await createUser(
      "Source Customer",
      "transaction-source-customer@example.com",
      "CUSTOMER",
    );

    const customerAccount = await createAccount(customer.id);
    const otherAccount = await createAccount(otherCustomer.id);

    const transaction = await createTransaction({
      sourceAccountId: otherAccount.id,
      destinationAccountId: customerAccount.id,
    });

    const accessToken = createAccessToken(
      customer.id,
      customer.email,
      "CUSTOMER",
    );

    const response = await request(app)
      .get(`/api/v1/transactions/${transaction.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.transaction.id).toBe(transaction.id);
  });

  it("should reject CUSTOMER from viewing a transaction involving only other customers' accounts", async () => {
    const customer = await createUser(
      "Unauthorized Customer",
      "unauthorized-customer@example.com",
      "CUSTOMER",
    );

    const customerB = await createUser(
      "Customer B",
      "transaction-customer-b@example.com",
      "CUSTOMER",
    );

    const customerC = await createUser(
      "Customer C",
      "transaction-customer-c@example.com",
      "CUSTOMER",
    );

    const accountB = await createAccount(customerB.id);
    const accountC = await createAccount(customerC.id);

    const transaction = await createTransaction({
      sourceAccountId: accountB.id,
      destinationAccountId: accountC.id,
    });

    const accessToken = createAccessToken(
      customer.id,
      customer.email,
      "CUSTOMER",
    );

    const response = await request(app)
      .get(`/api/v1/transactions/${transaction.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should allow ADMIN to view any transaction", async () => {
    const admin = await createUser(
      "Admin User",
      "transaction-admin@example.com",
      "ADMIN",
    );

    const customerA = await createUser(
      "Customer A",
      "transaction-admin-a@example.com",
      "CUSTOMER",
    );

    const customerB = await createUser(
      "Customer B",
      "transaction-admin-b@example.com",
      "CUSTOMER",
    );

    const sourceAccount = await createAccount(customerA.id);
    const destinationAccount = await createAccount(customerB.id);

    const transaction = await createTransaction({
      sourceAccountId: sourceAccount.id,
      destinationAccountId: destinationAccount.id,
    });

    const accessToken = createAccessToken(
      admin.id,
      admin.email,
      "ADMIN",
    );

    const response = await request(app)
      .get(`/api/v1/transactions/${transaction.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it("should allow SUPPORT to view a transaction", async () => {
    const support = await createUser(
      "Support User",
      "transaction-support@example.com",
      "SUPPORT",
    );

    const customer = await createUser(
      "Customer User",
      "transaction-support-customer@example.com",
      "CUSTOMER",
    );

    const account = await createAccount(customer.id);

    const transaction = await createTransaction({
      sourceAccountId: account.id,
    });

    const accessToken = createAccessToken(
      support.id,
      support.email,
      "SUPPORT",
    );

    const response = await request(app)
      .get(`/api/v1/transactions/${transaction.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it("should allow AUDITOR to view a transaction", async () => {
    const auditor = await createUser(
      "Auditor User",
      "transaction-auditor@example.com",
      "AUDITOR",
    );

    const customer = await createUser(
      "Customer User",
      "transaction-auditor-customer@example.com",
      "CUSTOMER",
    );

    const account = await createAccount(customer.id);

    const transaction = await createTransaction({
      sourceAccountId: account.id,
    });

    const accessToken = createAccessToken(
      auditor.id,
      auditor.email,
      "AUDITOR",
    );

    const response = await request(app)
      .get(`/api/v1/transactions/${transaction.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it("should return 404 when the transaction does not exist", async () => {
    const customer = await createUser(
      "Missing Transaction Customer",
      "missing-transaction@example.com",
      "CUSTOMER",
    );

    const accessToken = createAccessToken(
      customer.id,
      customer.email,
      "CUSTOMER",
    );

    const response = await request(app)
      .get(
        "/api/v1/transactions/00000000-0000-0000-0000-000000000000",
      )
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("should reject unauthenticated access", async () => {
    const response = await request(app).get(
      "/api/v1/transactions/00000000-0000-0000-0000-000000000000",
    );

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject a refresh token from the transaction route", async () => {
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
      .get(
        "/api/v1/transactions/00000000-0000-0000-0000-000000000000",
      )
      .set("Authorization", `Bearer ${refreshToken}`);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should not expose sensitive authentication data", async () => {
    const customer = await createUser(
      "Sensitive Data Customer",
      "sensitive-transaction@example.com",
      "CUSTOMER",
    );

    const account = await createAccount(customer.id);

    const transaction = await createTransaction({
      sourceAccountId: account.id,
    });

    const accessToken = createAccessToken(
      customer.id,
      customer.email,
      "CUSTOMER",
    );

    const response = await request(app)
      .get(`/api/v1/transactions/${transaction.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);

    const responseText = JSON.stringify(response.body);

    expect(responseText).not.toContain(accessToken);
    expect(responseText).not.toContain("password");
    expect(responseText).not.toContain("passwordHash");
    expect(responseText).not.toContain("refreshToken");
  });

  it("should include requestId for an authorized transaction request", async () => {
    const customer = await createUser(
      "Request ID Customer",
      "transaction-request-id@example.com",
      "CUSTOMER",
    );

    const account = await createAccount(customer.id);

    const transaction = await createTransaction({
      sourceAccountId: account.id,
    });

    const accessToken = createAccessToken(
      customer.id,
      customer.email,
      "CUSTOMER",
    );

    const response = await request(app)
      .get(`/api/v1/transactions/${transaction.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.requestId).toEqual(
      expect.any(String),
    );
  });
});