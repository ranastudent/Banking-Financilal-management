import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";

const createdUserIds: string[] = [];
const createdCurrencyCodes: string[] = [];

const createTestUser = async (
  role: "CUSTOMER" | "ADMIN" | "SUPPORT" | "AUDITOR",
) => {
  const user = await prisma.user.create({
    data: {
      name: `Admin Currency Test ${Date.now()}-${Math.random()}`,
      email: `admin-currency-${Date.now()}-${Math.random()}@example.com`,
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
  } while (
    await prisma.currency.findUnique({
      where: {
        code: currencyCode,
      },
    })
  );

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
      jti: `test-jti-${Date.now()}-${Math.random()}`,
    },
    env.jwtRefreshSecret,
    {
      expiresIn: "7d",
    },
  );
};

afterEach(async () => {
  if (createdCurrencyCodes.length > 0) {
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

describe("ADMIN Currency Read Authorization", () => {
  it("should allow ADMIN to view a currency by code", async () => {
    const admin = await createTestUser("ADMIN");
    const currency = await createTestCurrency();

    const token = createAccessToken(admin);

    const response = await request(app)
      .get(`/api/v1/admin/currencies/${currency.code}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(response.body.data.currency.code).toBe(currency.code);
    expect(response.body.data.currency.name).toBe(currency.name);
    expect(response.body.data.currency.symbol).toBe(currency.symbol);
    expect(response.body.data.currency.decimalPlaces).toBe(
      currency.decimalPlaces,
    );
    expect(response.body.data.currency.isActive).toBe(
      currency.isActive,
    );
  });

  it("should allow AUDITOR to view a currency by code", async () => {
    const auditor = await createTestUser("AUDITOR");
    const currency = await createTestCurrency();

    const token = createAccessToken(auditor);

    const response = await request(app)
      .get(`/api/v1/admin/currencies/${currency.code}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.currency.code).toBe(currency.code);
  });

  it("should allow SUPPORT to view a currency by code", async () => {
    const support = await createTestUser("SUPPORT");
    const currency = await createTestCurrency();

    const token = createAccessToken(support);

    const response = await request(app)
      .get(`/api/v1/admin/currencies/${currency.code}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.currency.code).toBe(currency.code);
  });

  it("should reject CUSTOMER from viewing a currency by code", async () => {
    const customer = await createTestUser("CUSTOMER");
    const currency = await createTestCurrency();

    const token = createAccessToken(customer);

    const response = await request(app)
      .get(`/api/v1/admin/currencies/${currency.code}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject unauthenticated access to a currency by code", async () => {
    const currency = await createTestCurrency();

    const response = await request(app).get(
      `/api/v1/admin/currencies/${currency.code}`,
    );

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject a refresh token on the currency route", async () => {
    const admin = await createTestUser("ADMIN");
    const currency = await createTestCurrency();

    const refreshToken = createRefreshToken(admin);

    const response = await request(app)
      .get(`/api/v1/admin/currencies/${currency.code}`)
      .set("Authorization", `Bearer ${refreshToken}`);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should return 404 when the requested currency does not exist", async () => {
    const admin = await createTestUser("ADMIN");

    const token = createAccessToken(admin);

    const response = await request(app)
      .get("/api/v1/admin/currencies/ZZZ")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("should normalize a lowercase currency code to uppercase", async () => {
    const admin = await createTestUser("ADMIN");
    const currency = await createTestCurrency();

    const token = createAccessToken(admin);

    const response = await request(app)
      .get(`/api/v1/admin/currencies/${currency.code.toLowerCase()}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.currency.code).toBe(currency.code);
  });

  it("should reject an invalid currency code format", async () => {
    const admin = await createTestUser("ADMIN");

    const token = createAccessToken(admin);

    const response = await request(app)
      .get("/api/v1/admin/currencies/USDT")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("BAD_REQUEST");
  });

  it("should include requestId for an authorized currency read", async () => {
    const admin = await createTestUser("ADMIN");
    const currency = await createTestCurrency();

    const token = createAccessToken(admin);

    const response = await request(app)
      .get(`/api/v1/admin/currencies/${currency.code}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.requestId).toBeDefined();
    expect(typeof response.body.requestId).toBe("string");
    expect(response.body.requestId.length).toBeGreaterThan(0);
  });

  it("should allow ADMIN to list currencies with pagination", async () => {
    const admin = await createTestUser("ADMIN");

    await createTestCurrency();
    await createTestCurrency();
    await createTestCurrency();

    const token = createAccessToken(admin);

    const response = await request(app)
      .get("/api/v1/admin/currencies?page=1&limit=2")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(response.body.data).toHaveProperty("currencies");
    expect(response.body.data).toHaveProperty("pagination");

    expect(Array.isArray(response.body.data.currencies)).toBe(true);
    expect(response.body.data.currencies.length).toBeLessThanOrEqual(
      2,
    );

    expect(response.body.data.pagination.page).toBe(1);
    expect(response.body.data.pagination.limit).toBe(2);
    expect(typeof response.body.data.pagination.total).toBe("number");
    expect(typeof response.body.data.pagination.totalPages).toBe(
      "number",
    );
  });

  it("should allow AUDITOR to list currencies", async () => {
    const auditor = await createTestUser("AUDITOR");

    await createTestCurrency();

    const token = createAccessToken(auditor);

    const response = await request(app)
      .get("/api/v1/admin/currencies?page=1&limit=10")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data.currencies)).toBe(true);
  });

  it("should allow SUPPORT to list currencies", async () => {
    const support = await createTestUser("SUPPORT");

    await createTestCurrency();

    const token = createAccessToken(support);

    const response = await request(app)
      .get("/api/v1/admin/currencies?page=1&limit=10")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data.currencies)).toBe(true);
  });

  it("should reject CUSTOMER from listing currencies", async () => {
    const customer = await createTestUser("CUSTOMER");

    const token = createAccessToken(customer);

    const response = await request(app)
      .get("/api/v1/admin/currencies?page=1&limit=10")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject invalid pagination parameters", async () => {
    const admin = await createTestUser("ADMIN");

    const token = createAccessToken(admin);

    const response = await request(app)
      .get("/api/v1/admin/currencies?page=0&limit=101")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("BAD_REQUEST");
  });
});