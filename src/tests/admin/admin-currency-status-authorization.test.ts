import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";

const createdUserIds: string[] = [];
const createdCurrencyCodes: string[] = [];
const createdExchangeRateIds: string[] = [];
const createdAccountIds: string[] = [];

const createTestUser = async (
  role: "CUSTOMER" | "ADMIN" | "SUPPORT" | "AUDITOR",
) => {
  const user = await prisma.user.create({
    data: {
      name: `Currency Status Test ${Date.now()}-${Math.random()}`,
      email: `currency-status-${Date.now()}-${Math.random()}@example.com`,
      phone: `017${Math.floor(10000000 + Math.random() * 89999999)}`,
      passwordHash: "test-password-hash",
      role,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });

  createdUserIds.push(user.id);

  return user;
};

const createTestCurrency = async () => {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  let currencyCode = "";

  do {
    currencyCode = Array.from({ length: 3 }, () =>
      letters[Math.floor(Math.random() * letters.length)],
    ).join("");

    const existing = await prisma.currency.findUnique({
      where: {
        code: currencyCode,
      },
    });

    if (!existing) {
      break;
    }
  } while (true);

  const currency = await prisma.currency.create({
    data: {
      code: currencyCode,
      name: `Test Currency ${currencyCode}`,
      symbol: "T",
      decimalPlaces: 2,
      isActive: true,
    },
  });

  createdCurrencyCodes.push(currency.code);

  return currency;
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

const createRefreshToken = (user: { id: string }) => {
  return jwt.sign(
    {
      sub: user.id,
      tokenType: "refresh",
      jti: `currency-status-jti-${Date.now()}-${Math.random()}`,
    },
    env.jwtRefreshSecret,
    {
      expiresIn: "7d",
    },
  );
};

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

  if (createdExchangeRateIds.length > 0) {
    await prisma.exchangeRate.deleteMany({
      where: {
        id: {
          in: createdExchangeRateIds,
        },
      },
    });

    createdExchangeRateIds.length = 0;
  }

  if (createdCurrencyCodes.length > 0) {
    await prisma.currencyReserve.deleteMany({
      where: {
        currencyCode: {
          in: createdCurrencyCodes,
        },
      },
    });

    await prisma.auditLog.deleteMany({
      where: {
        entityType: "CURRENCY",
        entityId: {
          in: createdCurrencyCodes,
        },
      },
    });

    await prisma.currency.deleteMany({
      where: {
        code: {
          in: createdCurrencyCodes,
        },
      },
    });

    createdCurrencyCodes.length = 0;
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

describe("ADMIN Currency Status Authorization", () => {
  it("should allow ADMIN to deactivate a currency", async () => {
    const admin = await createTestUser("ADMIN");
    const currency = await createTestCurrency();

    const token = createAccessToken(admin);

    const response = await request(app)
      .patch(`/api/v1/admin/currencies/${currency.code}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        isActive: false,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.currency.code).toBe(currency.code);
    expect(response.body.data.currency.isActive).toBe(false);
  });

  it("should allow ADMIN to reactivate a currency", async () => {
    const admin = await createTestUser("ADMIN");
    const currency = await createTestCurrency();

    await prisma.currency.update({
      where: {
        code: currency.code,
      },
      data: {
        isActive: false,
      },
    });

    const token = createAccessToken(admin);

    const response = await request(app)
      .patch(`/api/v1/admin/currencies/${currency.code}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        isActive: true,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.currency.isActive).toBe(true);
  });

  it("should reject CUSTOMER from changing currency status", async () => {
    const customer = await createTestUser("CUSTOMER");
    const currency = await createTestCurrency();

    const token = createAccessToken(customer);

    const response = await request(app)
      .patch(`/api/v1/admin/currencies/${currency.code}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        isActive: false,
      });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject SUPPORT from changing currency status", async () => {
    const support = await createTestUser("SUPPORT");
    const currency = await createTestCurrency();

    const token = createAccessToken(support);

    const response = await request(app)
      .patch(`/api/v1/admin/currencies/${currency.code}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        isActive: false,
      });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject AUDITOR from changing currency status", async () => {
    const auditor = await createTestUser("AUDITOR");
    const currency = await createTestCurrency();

    const token = createAccessToken(auditor);

    const response = await request(app)
      .patch(`/api/v1/admin/currencies/${currency.code}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        isActive: false,
      });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject unauthenticated status changes", async () => {
    const currency = await createTestCurrency();

    const response = await request(app)
      .patch(`/api/v1/admin/currencies/${currency.code}/status`)
      .send({
        isActive: false,
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject a refresh token", async () => {
    const admin = await createTestUser("ADMIN");
    const currency = await createTestCurrency();

    const refreshToken = createRefreshToken(admin);

    const response = await request(app)
      .patch(`/api/v1/admin/currencies/${currency.code}/status`)
      .set("Authorization", `Bearer ${refreshToken}`)
      .send({
        isActive: false,
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject an invalid currency code", async () => {
    const admin = await createTestUser("ADMIN");

    const token = createAccessToken(admin);

    const response = await request(app)
      .patch("/api/v1/admin/currencies/USDT/status")
      .set("Authorization", `Bearer ${token}`)
      .send({
        isActive: false,
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("BAD_REQUEST");
  });

  it("should reject a non-boolean isActive value", async () => {
    const admin = await createTestUser("ADMIN");
    const currency = await createTestCurrency();

    const token = createAccessToken(admin);

    const response = await request(app)
      .patch(`/api/v1/admin/currencies/${currency.code}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        isActive: "false",
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("BAD_REQUEST");
  });

  it("should return 404 when the currency does not exist", async () => {
    const admin = await createTestUser("ADMIN");

    const token = createAccessToken(admin);

    const response = await request(app)
      .patch("/api/v1/admin/currencies/ZZZ/status")
      .set("Authorization", `Bearer ${token}`)
      .send({
        isActive: false,
      });

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("should reject a status change when the currency is already in the requested state", async () => {
    const admin = await createTestUser("ADMIN");
    const currency = await createTestCurrency();

    const token = createAccessToken(admin);

    const response = await request(app)
      .patch(`/api/v1/admin/currencies/${currency.code}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        isActive: true,
      });

    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("CONFLICT");
  });

  it("should not deactivate a currency with active exchange rates", async () => {
    const admin = await createTestUser("ADMIN");
    const currency = await createTestCurrency();

    const exchangeRate = await prisma.exchangeRate.create({
      data: {
        baseCurrency: currency.code,
        quoteCurrency: "USD",
        rate: 1,
        version: 1,
        effectiveFrom: new Date(),
        status: "ACTIVE",
      },
    });

    createdExchangeRateIds.push(exchangeRate.id);

    const token = createAccessToken(admin);

    const response = await request(app)
      .patch(`/api/v1/admin/currencies/${currency.code}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        isActive: false,
      });

    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("CONFLICT");
  });

  it("should not deactivate a currency with non-zero customer balance", async () => {
    const admin = await createTestUser("ADMIN");
    const customer = await createTestUser("CUSTOMER");
    const currency = await createTestCurrency();

    const account = await prisma.account.create({
      data: {
        userId: customer.id,
        accountNumber: `97${Date.now()}${Math.floor(
          100000 + Math.random() * 900000,
        )}`,
        accountType: "SAVINGS",
        status: "ACTIVE",
      },
    });

    createdAccountIds.push(account.id);

    await prisma.accountBalance.create({
      data: {
        accountId: account.id,
        currencyCode: currency.code,
        availableBalance: 100,
        lockedBalance: 0,
      },
    });

    const token = createAccessToken(admin);

    const response = await request(app)
      .patch(`/api/v1/admin/currencies/${currency.code}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        isActive: false,
      });

    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("CONFLICT");
  });

  it("should create an audit log after a successful status change", async () => {
    const admin = await createTestUser("ADMIN");
    const currency = await createTestCurrency();

    const token = createAccessToken(admin);

    const response = await request(app)
      .patch(`/api/v1/admin/currencies/${currency.code}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        isActive: false,
      });

    expect(response.status).toBe(200);

    const auditLog = await prisma.auditLog.findFirst({
      where: {
        action: "CURRENCY_STATUS_CHANGED",
        entityType: "CURRENCY",
        entityId: currency.code,
        userId: admin.id,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    expect(auditLog).not.toBeNull();
    expect(auditLog?.metadata).toEqual({
      previousIsActive: true,
      newIsActive: false,
    });
  });

  it("should include requestId after a successful status change", async () => {
    const admin = await createTestUser("ADMIN");
    const currency = await createTestCurrency();

    const token = createAccessToken(admin);

    const response = await request(app)
      .patch(`/api/v1/admin/currencies/${currency.code}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        isActive: false,
      });

    expect(response.status).toBe(200);
    expect(response.body.requestId).toBeDefined();
    expect(typeof response.body.requestId).toBe("string");
    expect(response.body.requestId.length).toBeGreaterThan(0);
  });
});