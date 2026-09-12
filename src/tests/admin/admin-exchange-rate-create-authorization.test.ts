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
      name: `Exchange Rate Create Test ${Date.now()}-${Math.random()}`,
      email: `exchange-rate-create-${Date.now()}-${Math.random()}@example.com`,
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
  prefix: "BASE" | "QUOTE" = "BASE",
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

const createCurrencyPair = async () => {
  const baseCurrency = await createTestCurrency("BASE");
  const quoteCurrency = await createTestCurrency("QUOTE");

  return {
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

const createRefreshToken = (user: { id: string }) => {
  return jwt.sign(
    {
      sub: user.id,
      tokenType: "refresh",
      jti: `exchange-rate-create-jti-${Date.now()}-${Math.random()}`,
    },
    env.jwtRefreshSecret,
    {
      expiresIn: "7d",
    },
  );
};

const validPayload = (
  baseCurrency: string,
  quoteCurrency: string,
  overrides: Record<string, unknown> = {},
) => {
  return {
    baseCurrency,
    quoteCurrency,
    rate: 117.5,
    buyRate: 117,
    sellRate: 118,
    spread: 1,
    source: "TEST",
    version: 1,
    effectiveFrom: new Date(
      Date.now() + 60 * 60 * 1000,
    ).toISOString(),
    effectiveTo: null,
    status: "ACTIVE",
    ...overrides,
  };
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

describe("ADMIN Exchange Rate Create Authorization", () => {
  it("should allow ADMIN to create an exchange rate", async () => {
    const admin = await createTestUser("ADMIN");
    const { baseCurrency, quoteCurrency } =
      await createCurrencyPair();

    const token = createAccessToken(admin);

    const payload = validPayload(
      baseCurrency.code,
      quoteCurrency.code,
    );

    const response = await request(app)
      .post("/api/v1/admin/exchange-rates")
      .set("Authorization", `Bearer ${token}`)
      .send(payload);

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);

    expect(response.body.data.exchangeRate).toBeDefined();
    expect(response.body.data.exchangeRate.baseCurrency).toBe(
      baseCurrency.code,
    );
    expect(response.body.data.exchangeRate.quoteCurrency).toBe(
      quoteCurrency.code,
    );
    expect(response.body.data.exchangeRate.version).toBe(1);
    expect(response.body.data.exchangeRate.status).toBe("ACTIVE");

    createdExchangeRateIds.push(
      response.body.data.exchangeRate.id,
    );
  });

  it("should reject CUSTOMER from creating an exchange rate", async () => {
    const customer = await createTestUser("CUSTOMER");
    const { baseCurrency, quoteCurrency } =
      await createCurrencyPair();

    const token = createAccessToken(customer);

    const response = await request(app)
      .post("/api/v1/admin/exchange-rates")
      .set("Authorization", `Bearer ${token}`)
      .send(validPayload(baseCurrency.code, quoteCurrency.code));

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject SUPPORT from creating an exchange rate", async () => {
    const support = await createTestUser("SUPPORT");
    const { baseCurrency, quoteCurrency } =
      await createCurrencyPair();

    const token = createAccessToken(support);

    const response = await request(app)
      .post("/api/v1/admin/exchange-rates")
      .set("Authorization", `Bearer ${token}`)
      .send(validPayload(baseCurrency.code, quoteCurrency.code));

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject AUDITOR from creating an exchange rate", async () => {
    const auditor = await createTestUser("AUDITOR");
    const { baseCurrency, quoteCurrency } =
      await createCurrencyPair();

    const token = createAccessToken(auditor);

    const response = await request(app)
      .post("/api/v1/admin/exchange-rates")
      .set("Authorization", `Bearer ${token}`)
      .send(validPayload(baseCurrency.code, quoteCurrency.code));

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject unauthenticated exchange-rate creation", async () => {
    const { baseCurrency, quoteCurrency } =
      await createCurrencyPair();

    const response = await request(app)
      .post("/api/v1/admin/exchange-rates")
      .send(validPayload(baseCurrency.code, quoteCurrency.code));

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject a refresh token for exchange-rate creation", async () => {
    const admin = await createTestUser("ADMIN");
    const { baseCurrency, quoteCurrency } =
      await createCurrencyPair();

    const refreshToken = createRefreshToken(admin);

    const response = await request(app)
      .post("/api/v1/admin/exchange-rates")
      .set("Authorization", `Bearer ${refreshToken}`)
      .send(validPayload(baseCurrency.code, quoteCurrency.code));

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject a missing base currency", async () => {
    const admin = await createTestUser("ADMIN");
    const quoteCurrency = await createTestCurrency("QUOTE");

    const token = createAccessToken(admin);

    const response = await request(app)
      .post("/api/v1/admin/exchange-rates")
      .set("Authorization", `Bearer ${token}`)
      .send({
        quoteCurrency: quoteCurrency.code,
        rate: 117.5,
        version: 1,
        effectiveFrom: new Date().toISOString(),
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("should reject an invalid currency code format", async () => {
    const admin = await createTestUser("ADMIN");

    const token = createAccessToken(admin);

    const response = await request(app)
      .post("/api/v1/admin/exchange-rates")
      .set("Authorization", `Bearer ${token}`)
      .send(
        validPayload("USDT", "BDT"),
      );

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("should reject when base and quote currencies are the same", async () => {
    const admin = await createTestUser("ADMIN");
    const currency = await createTestCurrency();

    const token = createAccessToken(admin);

    const response = await request(app)
      .post("/api/v1/admin/exchange-rates")
      .set("Authorization", `Bearer ${token}`)
      .send(
        validPayload(currency.code, currency.code),
      );

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("should return 404 when the base currency does not exist", async () => {
    const admin = await createTestUser("ADMIN");
    const quoteCurrency = await createTestCurrency("QUOTE");

    const token = createAccessToken(admin);

    const response = await request(app)
      .post("/api/v1/admin/exchange-rates")
      .set("Authorization", `Bearer ${token}`)
      .send(
        validPayload("ZZZ", quoteCurrency.code),
      );

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("should return 404 when the quote currency does not exist", async () => {
    const admin = await createTestUser("ADMIN");
    const baseCurrency = await createTestCurrency("BASE");

    const token = createAccessToken(admin);

    const response = await request(app)
      .post("/api/v1/admin/exchange-rates")
      .set("Authorization", `Bearer ${token}`)
      .send(
        validPayload(baseCurrency.code, "ZZZ"),
      );

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("should reject an inactive base currency", async () => {
    const admin = await createTestUser("ADMIN");
    const { baseCurrency, quoteCurrency } =
      await createCurrencyPair();

    await prisma.currency.update({
      where: {
        code: baseCurrency.code,
      },
      data: {
        isActive: false,
      },
    });

    const token = createAccessToken(admin);

    const response = await request(app)
      .post("/api/v1/admin/exchange-rates")
      .set("Authorization", `Bearer ${token}`)
      .send(
        validPayload(
          baseCurrency.code,
          quoteCurrency.code,
        ),
      );

    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("CONFLICT");
  });

  it("should reject an inactive quote currency", async () => {
    const admin = await createTestUser("ADMIN");
    const { baseCurrency, quoteCurrency } =
      await createCurrencyPair();

    await prisma.currency.update({
      where: {
        code: quoteCurrency.code,
      },
      data: {
        isActive: false,
      },
    });

    const token = createAccessToken(admin);

    const response = await request(app)
      .post("/api/v1/admin/exchange-rates")
      .set("Authorization", `Bearer ${token}`)
      .send(
        validPayload(
          baseCurrency.code,
          quoteCurrency.code,
        ),
      );

    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("CONFLICT");
  });

  it("should reject a non-positive rate", async () => {
    const admin = await createTestUser("ADMIN");
    const { baseCurrency, quoteCurrency } =
      await createCurrencyPair();

    const token = createAccessToken(admin);

    const response = await request(app)
      .post("/api/v1/admin/exchange-rates")
      .set("Authorization", `Bearer ${token}`)
      .send(
        validPayload(
          baseCurrency.code,
          quoteCurrency.code,
          {
            rate: 0,
          },
        ),
      );

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("should reject an invalid version", async () => {
    const admin = await createTestUser("ADMIN");
    const { baseCurrency, quoteCurrency } =
      await createCurrencyPair();

    const token = createAccessToken(admin);

    const response = await request(app)
      .post("/api/v1/admin/exchange-rates")
      .set("Authorization", `Bearer ${token}`)
      .send(
        validPayload(
          baseCurrency.code,
          quoteCurrency.code,
          {
            version: 0,
          },
        ),
      );

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("should reject an invalid effective date range", async () => {
    const admin = await createTestUser("ADMIN");
    const { baseCurrency, quoteCurrency } =
      await createCurrencyPair();

    const effectiveFrom = new Date(
      Date.now() + 2 * 60 * 60 * 1000,
    );

    const effectiveTo = new Date(
      Date.now() + 60 * 60 * 1000,
    );

    const token = createAccessToken(admin);

    const response = await request(app)
      .post("/api/v1/admin/exchange-rates")
      .set("Authorization", `Bearer ${token}`)
      .send(
        validPayload(
          baseCurrency.code,
          quoteCurrency.code,
          {
            effectiveFrom: effectiveFrom.toISOString(),
            effectiveTo: effectiveTo.toISOString(),
          },
        ),
      );

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("should reject buyRate greater than the main rate", async () => {
    const admin = await createTestUser("ADMIN");
    const { baseCurrency, quoteCurrency } =
      await createCurrencyPair();

    const token = createAccessToken(admin);

    const response = await request(app)
      .post("/api/v1/admin/exchange-rates")
      .set("Authorization", `Bearer ${token}`)
      .send(
        validPayload(
          baseCurrency.code,
          quoteCurrency.code,
          {
            rate: 117,
            buyRate: 118,
          },
        ),
      );

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("should reject sellRate lower than the main rate", async () => {
    const admin = await createTestUser("ADMIN");
    const { baseCurrency, quoteCurrency } =
      await createCurrencyPair();

    const token = createAccessToken(admin);

    const response = await request(app)
      .post("/api/v1/admin/exchange-rates")
      .set("Authorization", `Bearer ${token}`)
      .send(
        validPayload(
          baseCurrency.code,
          quoteCurrency.code,
          {
            rate: 117,
            sellRate: 116,
          },
        ),
      );

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("should reject a duplicate currency-pair version", async () => {
    const admin = await createTestUser("ADMIN");
    const { baseCurrency, quoteCurrency } =
      await createCurrencyPair();

    const token = createAccessToken(admin);

    const payload = validPayload(
      baseCurrency.code,
      quoteCurrency.code,
      {
        version: 1,
        status: "INACTIVE",
      },
    );

    const firstResponse = await request(app)
      .post("/api/v1/admin/exchange-rates")
      .set("Authorization", `Bearer ${token}`)
      .send(payload);

    expect(firstResponse.status).toBe(201);

    createdExchangeRateIds.push(
      firstResponse.body.data.exchangeRate.id,
    );

    const secondResponse = await request(app)
      .post("/api/v1/admin/exchange-rates")
      .set("Authorization", `Bearer ${token}`)
      .send(payload);

    expect(secondResponse.status).toBe(409);
    expect(secondResponse.body.success).toBe(false);
    expect(secondResponse.body.error.code).toBe("CONFLICT");
  });

  it("should deactivate the previous active version when creating a new active version", async () => {
    const admin = await createTestUser("ADMIN");
    const { baseCurrency, quoteCurrency } =
      await createCurrencyPair();

    const token = createAccessToken(admin);

    const firstResponse = await request(app)
      .post("/api/v1/admin/exchange-rates")
      .set("Authorization", `Bearer ${token}`)
      .send(
        validPayload(
          baseCurrency.code,
          quoteCurrency.code,
          {
            version: 1,
            status: "ACTIVE",
          },
        ),
      );

    expect(firstResponse.status).toBe(201);

    const firstRateId =
      firstResponse.body.data.exchangeRate.id;

    createdExchangeRateIds.push(firstRateId);

    const secondResponse = await request(app)
      .post("/api/v1/admin/exchange-rates")
      .set("Authorization", `Bearer ${token}`)
      .send(
        validPayload(
          baseCurrency.code,
          quoteCurrency.code,
          {
            rate: 118.5,
            buyRate: 118,
            sellRate: 119,
            version: 2,
            status: "ACTIVE",
          },
        ),
      );

    expect(secondResponse.status).toBe(201);

    const secondRateId =
      secondResponse.body.data.exchangeRate.id;

    createdExchangeRateIds.push(secondRateId);

    const previousRate =
      await prisma.exchangeRate.findUnique({
        where: {
          id: firstRateId,
        },
      });

    const newRate =
      await prisma.exchangeRate.findUnique({
        where: {
          id: secondRateId,
        },
      });

    expect(previousRate?.status).toBe("INACTIVE");
    expect(previousRate?.effectiveTo).not.toBeNull();

    expect(newRate?.status).toBe("ACTIVE");
    expect(newRate?.version).toBe(2);
  });

  it("should create an audit log after successful exchange-rate creation", async () => {
    const admin = await createTestUser("ADMIN");
    const { baseCurrency, quoteCurrency } =
      await createCurrencyPair();

    const token = createAccessToken(admin);

    const response = await request(app)
      .post("/api/v1/admin/exchange-rates")
      .set("Authorization", `Bearer ${token}`)
      .send(
        validPayload(
          baseCurrency.code,
          quoteCurrency.code,
        ),
      );

    expect(response.status).toBe(201);

    const exchangeRateId =
      response.body.data.exchangeRate.id;

    createdExchangeRateIds.push(exchangeRateId);

    const auditLog = await prisma.auditLog.findFirst({
      where: {
        action: "EXCHANGE_RATE_CREATED",
        entityType: "EXCHANGE_RATE",
        entityId: exchangeRateId,
        userId: admin.id,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    expect(auditLog).not.toBeNull();

    expect(auditLog?.metadata).toEqual({
      baseCurrency: baseCurrency.code,
      quoteCurrency: quoteCurrency.code,
      version: 1,
      rate: 117.5,
      status: "ACTIVE",
    });
  });

  it("should include requestId after successful exchange-rate creation", async () => {
    const admin = await createTestUser("ADMIN");
    const { baseCurrency, quoteCurrency } =
      await createCurrencyPair();

    const token = createAccessToken(admin);

    const response = await request(app)
      .post("/api/v1/admin/exchange-rates")
      .set("Authorization", `Bearer ${token}`)
      .send(
        validPayload(
          baseCurrency.code,
          quoteCurrency.code,
        ),
      );

    expect(response.status).toBe(201);

    expect(response.body.requestId).toBeDefined();
    expect(typeof response.body.requestId).toBe("string");
    expect(response.body.requestId.length).toBeGreaterThan(0);

    createdExchangeRateIds.push(
      response.body.data.exchangeRate.id,
    );
  });
});