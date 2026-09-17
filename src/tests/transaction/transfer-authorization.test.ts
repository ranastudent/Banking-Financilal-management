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

describe("Transfer Authorization", () => {
  const createdUserIds: string[] = [];
  const createdAccountIds: string[] = [];
  const createdTransactionIds: string[] = [];

  beforeEach(() => {
    createdUserIds.length = 0;
    createdAccountIds.length = 0;
    createdTransactionIds.length = 0;
  });

  afterEach(async () => {
    // Delete transaction child records first.
    if (createdTransactionIds.length > 0) {
      await prisma.transactionLeg.deleteMany({
        where: {
          transactionId: {
            in: createdTransactionIds,
          },
        },
      });

      await prisma.ledgerEntry.deleteMany({
        where: {
          transactionId: {
            in: createdTransactionIds,
          },
        },
      });

      await prisma.transaction.deleteMany({
        where: {
          id: {
            in: createdTransactionIds,
          },
        },
      });

      createdTransactionIds.length = 0;
    }

    // Delete account balances first, then accounts.
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

    // Delete only users created by this test file.
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

  it("should allow CUSTOMER to transfer from their own account to another account", async () => {
    const customer = await createUser(
      "Customer One",
      `customer-one-${Date.now()}-${Math.random()}@example.com`,
      "CUSTOMER",
    );

    const destinationOwner = await createUser(
      "Customer Two",
      `customer-two-${Date.now()}-${Math.random()}@example.com`,
      "CUSTOMER",
    );

    const sourceAccount = await createAccount(customer.id);
    const destinationAccount = await createAccount(
      destinationOwner.id,
    );

    const accessToken = createAccessToken(
      customer.id,
      customer.email,
      "CUSTOMER",
    );

    const response = await request(app)
      .post(
        `/api/v1/transactions/transfer/${sourceAccount.id}/${destinationAccount.id}`,
      )
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      );

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.sourceAccountId).toBe(
      sourceAccount.id,
    );
    expect(response.body.data.destinationAccountId).toBe(
      destinationAccount.id,
    );
    expect(response.body.data.userId).toBe(customer.id);
    expect(response.body.data.userRole).toBe("CUSTOMER");
  });

  it("should reject CUSTOMER when the source account belongs to another customer", async () => {
    const customerA = await createUser(
      "Customer A",
      `transfer-customer-a-${Date.now()}-${Math.random()}@example.com`,
      "CUSTOMER",
    );

    const customerB = await createUser(
      "Customer B",
      `transfer-customer-b-${Date.now()}-${Math.random()}@example.com`,
      "CUSTOMER",
    );

    const destinationOwner = await createUser(
      "Customer C",
      `transfer-customer-c-${Date.now()}-${Math.random()}@example.com`,
      "CUSTOMER",
    );

    const sourceAccountB = await createAccount(customerB.id);

    const destinationAccount = await createAccount(
      destinationOwner.id,
    );

    const accessToken = createAccessToken(
      customerA.id,
      customerA.email,
      "CUSTOMER",
    );

    const response = await request(app)
      .post(
        `/api/v1/transactions/transfer/${sourceAccountB.id}/${destinationAccount.id}`,
      )
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      );

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should allow ADMIN to transfer between any two existing accounts", async () => {
    const admin = await createUser(
      "Admin User",
      `transfer-admin-${Date.now()}-${Math.random()}@example.com`,
      "ADMIN",
    );

    const customerA = await createUser(
      "Customer A",
      `transfer-admin-customer-a-${Date.now()}-${Math.random()}@example.com`,
      "CUSTOMER",
    );

    const customerB = await createUser(
      "Customer B",
      `transfer-admin-customer-b-${Date.now()}-${Math.random()}@example.com`,
      "CUSTOMER",
    );

    const sourceAccount = await createAccount(
      customerA.id,
    );

    const destinationAccount = await createAccount(
      customerB.id,
    );

    const accessToken = createAccessToken(
      admin.id,
      admin.email,
      "ADMIN",
    );

    const response = await request(app)
      .post(
        `/api/v1/transactions/transfer/${sourceAccount.id}/${destinationAccount.id}`,
      )
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      );

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.sourceAccountId).toBe(
      sourceAccount.id,
    );
    expect(response.body.data.destinationAccountId).toBe(
      destinationAccount.id,
    );
    expect(response.body.data.userId).toBe(admin.id);
    expect(response.body.data.userRole).toBe("ADMIN");
  });

  it("should reject SUPPORT from performing a transfer", async () => {
    const support = await createUser(
      "Support User",
      `transfer-support-${Date.now()}-${Math.random()}@example.com`,
      "SUPPORT",
    );

    const customerA = await createUser(
      "Customer A",
      `transfer-support-customer-a-${Date.now()}-${Math.random()}@example.com`,
      "CUSTOMER",
    );

    const customerB = await createUser(
      "Customer B",
      `transfer-support-customer-b-${Date.now()}-${Math.random()}@example.com`,
      "CUSTOMER",
    );

    const sourceAccount = await createAccount(
      customerA.id,
    );

    const destinationAccount = await createAccount(
      customerB.id,
    );

    const accessToken = createAccessToken(
      support.id,
      support.email,
      "SUPPORT",
    );

    const response = await request(app)
      .post(
        `/api/v1/transactions/transfer/${sourceAccount.id}/${destinationAccount.id}`,
      )
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      );

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject AUDITOR from performing a transfer", async () => {
    const auditor = await createUser(
      "Auditor User",
      `transfer-auditor-${Date.now()}-${Math.random()}@example.com`,
      "AUDITOR",
    );

    const customerA = await createUser(
      "Customer A",
      `transfer-auditor-customer-a-${Date.now()}-${Math.random()}@example.com`,
      "CUSTOMER",
    );

    const customerB = await createUser(
      "Customer B",
      `transfer-auditor-customer-b-${Date.now()}-${Math.random()}@example.com`,
      "CUSTOMER",
    );

    const sourceAccount = await createAccount(
      customerA.id,
    );

    const destinationAccount = await createAccount(
      customerB.id,
    );

    const accessToken = createAccessToken(
      auditor.id,
      auditor.email,
      "AUDITOR",
    );

    const response = await request(app)
      .post(
        `/api/v1/transactions/transfer/${sourceAccount.id}/${destinationAccount.id}`,
      )
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      );

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject a transfer when the source account does not exist", async () => {
    const customer = await createUser(
      "Customer Source Missing",
      `transfer-source-missing-${Date.now()}-${Math.random()}@example.com`,
      "CUSTOMER",
    );

    const destinationOwner = await createUser(
      "Customer Destination",
      `transfer-destination-source-missing-${Date.now()}-${Math.random()}@example.com`,
      "CUSTOMER",
    );

    const destinationAccount = await createAccount(
      destinationOwner.id,
    );

    const accessToken = createAccessToken(
      customer.id,
      customer.email,
      "CUSTOMER",
    );

    const response = await request(app)
      .post(
        `/api/v1/transactions/transfer/00000000-0000-0000-0000-000000000000/${destinationAccount.id}`,
      )
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      );

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "RESOURCE_NOT_FOUND",
    );
  });

  it("should reject a transfer when the destination account does not exist", async () => {
    const customer = await createUser(
      "Customer Destination Missing",
      `transfer-destination-missing-${Date.now()}-${Math.random()}@example.com`,
      "CUSTOMER",
    );

    const sourceAccount = await createAccount(
      customer.id,
    );

    const accessToken = createAccessToken(
      customer.id,
      customer.email,
      "CUSTOMER",
    );

    const response = await request(app)
      .post(
        `/api/v1/transactions/transfer/${sourceAccount.id}/00000000-0000-0000-0000-000000000000`,
      )
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      );

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "RESOURCE_NOT_FOUND",
    );
  });

  it("should reject a transfer when source and destination are the same account", async () => {
    const customer = await createUser(
      "Same Account Customer",
      `transfer-same-account-${Date.now()}-${Math.random()}@example.com`,
      "CUSTOMER",
    );

    const account = await createAccount(customer.id);

    const accessToken = createAccessToken(
      customer.id,
      customer.email,
      "CUSTOMER",
    );

    const response = await request(app)
      .post(
        `/api/v1/transactions/transfer/${account.id}/${account.id}`,
      )
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      );

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "BAD_REQUEST",
    );
  });

  it("should reject a transfer when authentication is missing", async () => {
    const response = await request(app).post(
      "/api/v1/transactions/transfer/00000000-0000-0000-0000-000000000000/11111111-1111-1111-1111-111111111111",
    );

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject a refresh token from the transfer route", async () => {
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
        "/api/v1/transactions/transfer/00000000-0000-0000-0000-000000000000/11111111-1111-1111-1111-111111111111",
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

  it("should not modify balances or create transactions during authorization", async () => {
    const customerA = await createUser(
      "Balance Customer A",
      `transfer-balance-a-${Date.now()}-${Math.random()}@example.com`,
      "CUSTOMER",
    );

    const customerB = await createUser(
      "Balance Customer B",
      `transfer-balance-b-${Date.now()}-${Math.random()}@example.com`,
      "CUSTOMER",
    );

    const sourceAccount = await createAccount(
      customerA.id,
    );

    const destinationAccount = await createAccount(
      customerB.id,
    );

    const accessToken = createAccessToken(
      customerA.id,
      customerA.email,
      "CUSTOMER",
    );

    const response = await request(app)
      .post(
        `/api/v1/transactions/transfer/${sourceAccount.id}/${destinationAccount.id}`,
      )
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      );

    expect(response.status).toBe(200);

    const sourceBalanceCount =
      await prisma.accountBalance.count({
        where: {
          accountId: sourceAccount.id,
        },
      });

    const destinationBalanceCount =
      await prisma.accountBalance.count({
        where: {
          accountId: destinationAccount.id,
        },
      });

    const transactionCount =
      await prisma.transaction.count({
        where: {
          OR: [
            {
              sourceAccountId: sourceAccount.id,
            },
            {
              destinationAccountId:
                destinationAccount.id,
            },
          ],
        },
      });

    expect(sourceBalanceCount).toBe(0);
    expect(destinationBalanceCount).toBe(0);
    expect(transactionCount).toBe(0);
  });

  it("should return requestId for a successful transfer authorization", async () => {
    const customerA = await createUser(
      "Request ID Customer A",
      `transfer-request-id-a-${Date.now()}-${Math.random()}@example.com`,
      "CUSTOMER",
    );

    const customerB = await createUser(
      "Request ID Customer B",
      `transfer-request-id-b-${Date.now()}-${Math.random()}@example.com`,
      "CUSTOMER",
    );

    const sourceAccount = await createAccount(
      customerA.id,
    );

    const destinationAccount = await createAccount(
      customerB.id,
    );

    const accessToken = createAccessToken(
      customerA.id,
      customerA.email,
      "CUSTOMER",
    );

    const response = await request(app)
      .post(
        `/api/v1/transactions/transfer/${sourceAccount.id}/${destinationAccount.id}`,
      )
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      );

    expect(response.status).toBe(200);
    expect(response.body.requestId).toEqual(
      expect.any(String),
    );
  });
});