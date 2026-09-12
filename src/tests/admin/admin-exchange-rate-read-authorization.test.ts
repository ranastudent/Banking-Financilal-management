import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";

const createdUserIds: string[] = [];
const createdCurrencyCodes: string[] = [];
const createdExchangeRateIds: string[] = [];

const createTestUser = async (
  role: "CUSTOMER" | "ADMIN" | "SUPPORT" | "AUDITOR",
) => {
  const user = await prisma.user.create({
    data: {
      name: `Exchange Rate Test ${Date.now()}-${Math.random()}`,
      email: `exchange-rate-${Date.now()}-${Math.random()}@example.com`,
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

const createTestCurrency = async (
  prefix: "BASE" | "QUOTE",
) => {
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
      name: `${prefix} Test Currency ${currencyCode}`,
      symbol: "T",
      decimalPlaces: 2,
      isActive: true,
    },
  });

  createdCurrencyCodes.push(currency.code);

  return currency;
};

const createTestExchangeRate = async () => {
  const baseCurrency = await createTestCurrency("BASE");
  const quoteCurrency = await createTestCurrency("QUOTE");

  const exchangeRate = await prisma.exchangeRate.create({
    data: {
      baseCurrency: baseCurrency.code,
      quoteCurrency: quoteCurrency.code,
      rate: 117.5,
      buyRate: 117,
      sellRate: 118,
      spread: 1,
      source: "TEST",
      version: 1,
      effectiveFrom: new Date(),
      effectiveTo: null,
      status: "ACTIVE",
    },
  });

  createdExchangeRateIds.push(exchangeRate.id);

  return {
    exchangeRate,
    baseCurrency,
    quoteCurrency,
  };
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

const createRefreshToken = (user: {
  id: string;
}) => {
  return jwt.sign(
    {
      sub: user.id,
      tokenType: "refresh",
      jti: `exchange-rate-jti-${Date.now()}-${Math.random()}`,
    },
    env.jwtRefreshSecret,
    {
      expiresIn: "7d",
    },
  );
};

afterEach(async () => {
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

describe("ADMIN Exchange Rate Read Authorization", () => {
  it("should allow ADMIN to view an exchange rate by ID", async () => {
    const admin = await createTestUser("ADMIN");
    const { exchangeRate, baseCurrency, quoteCurrency } =
      await createTestExchangeRate();

    const token = createAccessToken(admin);

    const response = await request(app)
      .get(`/api/v1/admin/exchange-rates/${exchangeRate.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(response.body.data.exchangeRate.id).toBe(exchangeRate.id);
    expect(response.body.data.exchangeRate.baseCurrency).toBe(
      baseCurrency.code,
    );
    expect(response.body.data.exchangeRate.quoteCurrency).toBe(
      quoteCurrency.code,
    );
    expect(response.body.data.exchangeRate.version).toBe(1);
    expect(response.body.data.exchangeRate.status).toBe("ACTIVE");
  });

  it("should allow AUDITOR to view an exchange rate by ID", async () => {
    const auditor = await createTestUser("AUDITOR");
    const { exchangeRate } = await createTestExchangeRate();

    const token = createAccessToken(auditor);

    const response = await request(app)
      .get(`/api/v1/admin/exchange-rates/${exchangeRate.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.exchangeRate.id).toBe(
      exchangeRate.id,
    );
  });

  it("should allow SUPPORT to view an exchange rate by ID", async () => {
    const support = await createTestUser("SUPPORT");
    const { exchangeRate } = await createTestExchangeRate();

    const token = createAccessToken(support);

    const response = await request(app)
      .get(`/api/v1/admin/exchange-rates/${exchangeRate.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.exchangeRate.id).toBe(
      exchangeRate.id,
    );
  });

  it("should allow CUSTOMER to view an exchange rate by ID", async () => {
    const customer = await createTestUser("CUSTOMER");
    const { exchangeRate } = await createTestExchangeRate();

    const token = createAccessToken(customer);

    const response = await request(app)
      .get(`/api/v1/admin/exchange-rates/${exchangeRate.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.exchangeRate.id).toBe(
      exchangeRate.id,
    );
  });

  it("should reject unauthenticated access to an exchange rate by ID", async () => {
    const { exchangeRate } = await createTestExchangeRate();

    const response = await request(app).get(
      `/api/v1/admin/exchange-rates/${exchangeRate.id}`,
    );

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject a refresh token on the exchange-rate route", async () => {
    const admin = await createTestUser("ADMIN");
    const { exchangeRate } = await createTestExchangeRate();

    const refreshToken = createRefreshToken(admin);

    const response = await request(app)
      .get(`/api/v1/admin/exchange-rates/${exchangeRate.id}`)
      .set("Authorization", `Bearer ${refreshToken}`);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should return 404 when the requested exchange rate does not exist", async () => {
    const admin = await createTestUser("ADMIN");

    const token = createAccessToken(admin);

    const response = await request(app)
      .get(
        "/api/v1/admin/exchange-rates/00000000-0000-0000-0000-000000000000",
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("should include both currency details in the exchange-rate response", async () => {
    const admin = await createTestUser("ADMIN");

    const {
      exchangeRate,
      baseCurrency,
      quoteCurrency,
    } = await createTestExchangeRate();

    const token = createAccessToken(admin);

    const response = await request(app)
      .get(`/api/v1/admin/exchange-rates/${exchangeRate.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);

    const returnedRate = response.body.data.exchangeRate;

    expect(returnedRate.baseCurrencyRef.code).toBe(
      baseCurrency.code,
    );
    expect(returnedRate.baseCurrencyRef.name).toBe(
      baseCurrency.name,
    );

    expect(returnedRate.quoteCurrencyRef.code).toBe(
      quoteCurrency.code,
    );
    expect(returnedRate.quoteCurrencyRef.name).toBe(
      quoteCurrency.name,
    );
  });

  it("should not expose unrelated sensitive fields in an exchange-rate response", async () => {
    const admin = await createTestUser("ADMIN");
    const { exchangeRate } = await createTestExchangeRate();

    const token = createAccessToken(admin);

    const response = await request(app)
      .get(`/api/v1/admin/exchange-rates/${exchangeRate.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);

    const returnedRate = response.body.data.exchangeRate;

    expect(returnedRate).not.toHaveProperty("password");
    expect(returnedRate).not.toHaveProperty("passwordHash");
    expect(returnedRate).not.toHaveProperty("accessToken");
    expect(returnedRate).not.toHaveProperty("refreshToken");
  });

  it("should include requestId for an authorized exchange-rate read", async () => {
    const admin = await createTestUser("ADMIN");
    const { exchangeRate } = await createTestExchangeRate();

    const token = createAccessToken(admin);

    const response = await request(app)
      .get(`/api/v1/admin/exchange-rates/${exchangeRate.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.requestId).toBeDefined();
    expect(typeof response.body.requestId).toBe("string");
    expect(response.body.requestId.length).toBeGreaterThan(0);
  });

  it("should allow ADMIN to list exchange rates with pagination", async () => {
    const admin = await createTestUser("ADMIN");

    await createTestExchangeRate();
    await createTestExchangeRate();
    await createTestExchangeRate();

    const token = createAccessToken(admin);

    const response = await request(app)
      .get("/api/v1/admin/exchange-rates?page=1&limit=2")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(response.body.data).toHaveProperty("exchangeRates");
    expect(response.body.data).toHaveProperty("pagination");

    expect(
      Array.isArray(response.body.data.exchangeRates),
    ).toBe(true);

    expect(
      response.body.data.exchangeRates.length,
    ).toBeLessThanOrEqual(2);

    expect(response.body.data.pagination.page).toBe(1);
    expect(response.body.data.pagination.limit).toBe(2);

    expect(
      typeof response.body.data.pagination.total,
    ).toBe("number");

    expect(
      typeof response.body.data.pagination.totalPages,
    ).toBe("number");
  });

  it("should allow AUDITOR to list exchange rates", async () => {
    const auditor = await createTestUser("AUDITOR");

    await createTestExchangeRate();

    const token = createAccessToken(auditor);

    const response = await request(app)
      .get("/api/v1/admin/exchange-rates?page=1&limit=10")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(
      Array.isArray(response.body.data.exchangeRates),
    ).toBe(true);
  });

  it("should allow SUPPORT to list exchange rates", async () => {
    const support = await createTestUser("SUPPORT");

    await createTestExchangeRate();

    const token = createAccessToken(support);

    const response = await request(app)
      .get("/api/v1/admin/exchange-rates?page=1&limit=10")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(
      Array.isArray(response.body.data.exchangeRates),
    ).toBe(true);
  });

  it("should allow CUSTOMER to list exchange rates", async () => {
    const customer = await createTestUser("CUSTOMER");

    await createTestExchangeRate();

    const token = createAccessToken(customer);

    const response = await request(app)
      .get("/api/v1/admin/exchange-rates?page=1&limit=10")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(
      Array.isArray(response.body.data.exchangeRates),
    ).toBe(true);
  });

  it("should reject invalid pagination parameters", async () => {
    const admin = await createTestUser("ADMIN");

    const token = createAccessToken(admin);

    const response = await request(app)
      .get("/api/v1/admin/exchange-rates?page=0&limit=101")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("BAD_REQUEST");
  });
});