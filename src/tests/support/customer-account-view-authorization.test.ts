import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";

const createdBalanceIds: string[] = [];
const createdAccountIds: string[] = [];
const createdCurrencyCodes: string[] = [];
const createdUserIds: string[] = [];

const createTestUser = async (
  role: "CUSTOMER" | "ADMIN" | "SUPPORT" | "AUDITOR",
) => {
  const user = await prisma.user.create({
    data: {
      name: `Support Account ${role} ${crypto.randomUUID()}`,
      email: `support-account-${role.toLowerCase()}-${crypto.randomUUID()}@example.com`,
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
      accountNumber: `20${Date.now()}${Math.floor(
        100000 + Math.random() * 900000,
      )}`,
      accountType: "SAVINGS",
      status: "ACTIVE",
    },
  });

  createdAccountIds.push(account.id);

  return account;
};

const createTestCurrency = async (code: string) => {
  const currency = await prisma.currency.create({
    data: {
      code,
      name: `${code} Test Currency`,
      symbol: code,
      decimalPlaces: 2,
      isActive: true,
    },
  });

  createdCurrencyCodes.push(currency.code);

  return currency;
};

const createTestBalance = async (
  accountId: string,
  currencyCode: string,
) => {
  const balance = await prisma.accountBalance.create({
    data: {
      accountId,
      currencyCode,
      availableBalance: "125000.50000000",
      lockedBalance: "5000.25000000",
    },
  });

  createdBalanceIds.push(balance.id);

  return balance;
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

const createRefreshToken = (userId: string) => {
  return jwt.sign(
    {
      sub: userId,
      tokenType: "refresh",
      jti: `support-account-test-${crypto.randomUUID()}`,
    },
    env.jwtRefreshSecret,
    {
      expiresIn: "7d",
    },
  );
};

const createCurrencyCode = () => {
  return `T${String.fromCharCode(
    65 + Math.floor(Math.random() * 26),
  )}${String.fromCharCode(
    65 + Math.floor(Math.random() * 26),
  )}`;
};

afterEach(async () => {
  if (createdBalanceIds.length > 0) {
    const ids = [...createdBalanceIds];
    createdBalanceIds.length = 0;

    await prisma.accountBalance.deleteMany({
      where: {
        id: {
          in: ids,
        },
      },
    });
  }

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

  if (createdCurrencyCodes.length > 0) {
    const codes = [...createdCurrencyCodes];
    createdCurrencyCodes.length = 0;

    await prisma.currency.deleteMany({
      where: {
        code: {
          in: codes,
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

describe("SUPPORT Customer Account View Authorization", () => {
  it("should allow SUPPORT to view a customer account", async () => {
    const support = await createTestUser("SUPPORT");
    const customer = await createTestUser("CUSTOMER");

    const account = await createTestAccount(customer.id);

    const token = createAccessToken(support);

    const response = await request(app)
      .get(
        `/api/v1/support/customers/accounts/${account.id}`,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(response.body.data.account.id).toBe(account.id);
    expect(response.body.data.account.userId).toBe(customer.id);
    expect(response.body.data.account.user.id).toBe(customer.id);
    expect(response.body.data.account.accountNumber).toBe(
      account.accountNumber,
    );
  });

  it("should return customer account balances", async () => {
    const support = await createTestUser("SUPPORT");
    const customer = await createTestUser("CUSTOMER");

    const account = await createTestAccount(customer.id);

    const currencyCode = createCurrencyCode();
    await createTestCurrency(currencyCode);
    await createTestBalance(account.id, currencyCode);

    const token = createAccessToken(support);

    const response = await request(app)
      .get(
        `/api/v1/support/customers/accounts/${account.id}`,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);

    const balances =
      response.body.data.account.balances;

    expect(balances).toHaveLength(1);
    expect(balances[0].currencyCode.trim()).toBe(currencyCode);
    expect(balances[0].availableBalance).toBe(
      "125000.5",
    );
    expect(balances[0].lockedBalance).toBe(
      "5000.25",
    );
  });

  it("should not allow SUPPORT to view an ADMIN account", async () => {
    const support = await createTestUser("SUPPORT");
    const admin = await createTestUser("ADMIN");

    const account = await createTestAccount(admin.id);

    const token = createAccessToken(support);

    const response = await request(app)
      .get(
        `/api/v1/support/customers/accounts/${account.id}`,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "RESOURCE_NOT_FOUND",
    );
  });

  it("should not allow SUPPORT to view another SUPPORT account", async () => {
    const support = await createTestUser("SUPPORT");
    const otherSupport = await createTestUser("SUPPORT");

    const account = await createTestAccount(
      otherSupport.id,
    );

    const token = createAccessToken(support);

    const response = await request(app)
      .get(
        `/api/v1/support/customers/accounts/${account.id}`,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "RESOURCE_NOT_FOUND",
    );
  });

  it("should not allow SUPPORT to view an AUDITOR account", async () => {
    const support = await createTestUser("SUPPORT");
    const auditor = await createTestUser("AUDITOR");

    const account = await createTestAccount(auditor.id);

    const token = createAccessToken(support);

    const response = await request(app)
      .get(
        `/api/v1/support/customers/accounts/${account.id}`,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "RESOURCE_NOT_FOUND",
    );
  });

  it("should reject CUSTOMER access", async () => {
    const customer = await createTestUser("CUSTOMER");
    const targetCustomer = await createTestUser(
      "CUSTOMER",
    );

    const account = await createTestAccount(
      targetCustomer.id,
    );

    const token = createAccessToken(customer);

    const response = await request(app)
      .get(
        `/api/v1/support/customers/accounts/${account.id}`,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject ADMIN access to the SUPPORT route", async () => {
    const admin = await createTestUser("ADMIN");
    const customer = await createTestUser("CUSTOMER");

    const account = await createTestAccount(customer.id);

    const token = createAccessToken(admin);

    const response = await request(app)
      .get(
        `/api/v1/support/customers/accounts/${account.id}`,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject AUDITOR access", async () => {
    const auditor = await createTestUser("AUDITOR");
    const customer = await createTestUser("CUSTOMER");

    const account = await createTestAccount(customer.id);

    const token = createAccessToken(auditor);

    const response = await request(app)
      .get(
        `/api/v1/support/customers/accounts/${account.id}`,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject unauthenticated access", async () => {
    const customer = await createTestUser("CUSTOMER");
    const account = await createTestAccount(customer.id);

    const response = await request(app).get(
      `/api/v1/support/customers/accounts/${account.id}`,
    );

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject a refresh token", async () => {
    const support = await createTestUser("SUPPORT");
    const customer = await createTestUser("CUSTOMER");

    const account = await createTestAccount(customer.id);

    const refreshToken = createRefreshToken(support.id);

    const response = await request(app)
      .get(
        `/api/v1/support/customers/accounts/${account.id}`,
      )
      .set(
        "Authorization",
        `Bearer ${refreshToken}`,
      );

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should return 404 for a nonexistent account", async () => {
    const support = await createTestUser("SUPPORT");

    const token = createAccessToken(support);

    const response = await request(app).get(
      "/api/v1/support/customers/accounts/00000000-0000-0000-0000-000000000000",
    ).set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "RESOURCE_NOT_FOUND",
    );
  });

  it("should reject an invalid account ID", async () => {
    const support = await createTestUser("SUPPORT");

    const token = createAccessToken(support);

    const response = await request(app)
      .get(
        "/api/v1/support/customers/accounts/not-a-uuid",
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("should not expose passwordHash or password", async () => {
    const support = await createTestUser("SUPPORT");
    const customer = await createTestUser("CUSTOMER");

    const account = await createTestAccount(customer.id);

    const token = createAccessToken(support);

    const response = await request(app)
      .get(
        `/api/v1/support/customers/accounts/${account.id}`,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);

    const returnedAccount =
      response.body.data.account;

    expect(returnedAccount).not.toHaveProperty(
      "passwordHash",
    );

    expect(returnedAccount.user).not.toHaveProperty(
      "passwordHash",
    );

    expect(returnedAccount.user).not.toHaveProperty(
      "password",
    );

    expect(returnedAccount.user).not.toHaveProperty(
      "accessToken",
    );

    expect(returnedAccount.user).not.toHaveProperty(
      "refreshToken",
    );
  });

  it("should include requestId", async () => {
    const support = await createTestUser("SUPPORT");
    const customer = await createTestUser("CUSTOMER");

    const account = await createTestAccount(customer.id);

    const token = createAccessToken(support);

    const response = await request(app)
      .get(
        `/api/v1/support/customers/accounts/${account.id}`,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.requestId).toBeDefined();
    expect(typeof response.body.requestId).toBe("string");
    expect(response.body.requestId.length).toBeGreaterThan(
      0,
    );
  });

  it("should not mutate account information", async () => {
    const support = await createTestUser("SUPPORT");
    const customer = await createTestUser("CUSTOMER");

    const account = await createTestAccount(customer.id);

    const token = createAccessToken(support);

    const response = await request(app)
      .get(
        `/api/v1/support/customers/accounts/${account.id}`,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);

    const databaseAccount =
      await prisma.account.findUnique({
        where: {
          id: account.id,
        },
      });

    expect(databaseAccount).not.toBeNull();
    expect(databaseAccount?.status).toBe(
      account.status,
    );
    expect(databaseAccount?.accountNumber).toBe(
      account.accountNumber,
    );
    expect(databaseAccount?.userId).toBe(customer.id);
  });
});