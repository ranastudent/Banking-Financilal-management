import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";

const createdUserIds: string[] = [];
const createdCurrencyCodes: string[] = [];
const createdReserveIds: string[] = [];

const createTestUser = async (
  role: "CUSTOMER" | "ADMIN" | "SUPPORT" | "AUDITOR",
) => {
  const user = await prisma.user.create({
    data: {
      name: `Currency Reserve Test ${Date.now()}-${Math.random()}`,
      email: `currency-reserve-${Date.now()}-${Math.random()}@example.com`,
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

const createTestCurrencyWithReserve = async () => {
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
      name: `Test Reserve Currency ${currencyCode}`,
      symbol: "T",
      decimalPlaces: 2,
      isActive: true,
    },
  });

  createdCurrencyCodes.push(currency.code);

  const reserve = await prisma.currencyReserve.create({
    data: {
      currencyCode: currency.code,
      availableReserve: 10000,
      lockedReserve: 1000,
      minimumReserve: 2000,
    },
  });

  createdReserveIds.push(reserve.id);

  return {
    currency,
    reserve,
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
      jti: `currency-reserve-jti-${Date.now()}-${Math.random()}`,
    },
    env.jwtRefreshSecret,
    {
      expiresIn: "7d",
    },
  );
};

afterEach(async () => {
  if (createdReserveIds.length > 0) {
    await prisma.reserveMovement.deleteMany({
      where: {
        reserveId: {
          in: createdReserveIds,
        },
      },
    });

    await prisma.currencyReserve.deleteMany({
      where: {
        id: {
          in: createdReserveIds,
        },
      },
    });

    createdReserveIds.length = 0;
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

describe("ADMIN Currency Reserve Read Authorization", () => {
  it("should allow ADMIN to view a currency reserve", async () => {
    const admin = await createTestUser("ADMIN");
    const { currency, reserve } =
      await createTestCurrencyWithReserve();

    const token = createAccessToken(admin);

    const response = await request(app)
      .get(
        `/api/v1/admin/currency-reserves/${currency.code}`,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(response.body.data.reserve.id).toBe(reserve.id);
    expect(response.body.data.reserve.currencyCode).toBe(
      currency.code,
    );
    expect(response.body.data.reserve.availableReserve).toBe(
      "10000",
    );
    expect(response.body.data.reserve.lockedReserve).toBe("1000");
    expect(response.body.data.reserve.minimumReserve).toBe(
      "2000",
    );
  });

  it("should allow AUDITOR to view a currency reserve", async () => {
    const auditor = await createTestUser("AUDITOR");
    const { currency, reserve } =
      await createTestCurrencyWithReserve();

    const token = createAccessToken(auditor);

    const response = await request(app)
      .get(
        `/api/v1/admin/currency-reserves/${currency.code}`,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.reserve.id).toBe(reserve.id);
  });

  it("should reject SUPPORT from viewing a currency reserve", async () => {
    const support = await createTestUser("SUPPORT");
    const { currency } = await createTestCurrencyWithReserve();

    const token = createAccessToken(support);

    const response = await request(app)
      .get(
        `/api/v1/admin/currency-reserves/${currency.code}`,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject CUSTOMER from viewing a currency reserve", async () => {
    const customer = await createTestUser("CUSTOMER");
    const { currency } = await createTestCurrencyWithReserve();

    const token = createAccessToken(customer);

    const response = await request(app)
      .get(
        `/api/v1/admin/currency-reserves/${currency.code}`,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject unauthenticated access to a currency reserve", async () => {
    const { currency } = await createTestCurrencyWithReserve();

    const response = await request(app).get(
      `/api/v1/admin/currency-reserves/${currency.code}`,
    );

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject a refresh token on the currency-reserve route", async () => {
    const admin = await createTestUser("ADMIN");
    const { currency } = await createTestCurrencyWithReserve();

    const refreshToken = createRefreshToken(admin);

    const response = await request(app)
      .get(
        `/api/v1/admin/currency-reserves/${currency.code}`,
      )
      .set("Authorization", `Bearer ${refreshToken}`);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should return 404 when the requested reserve does not exist", async () => {
    const admin = await createTestUser("ADMIN");

    const token = createAccessToken(admin);

    const response = await request(app)
      .get("/api/v1/admin/currency-reserves/ZZZ")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("should reject an invalid currency code format", async () => {
    const admin = await createTestUser("ADMIN");

    const token = createAccessToken(admin);

    const response = await request(app)
      .get("/api/v1/admin/currency-reserves/USDT")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("BAD_REQUEST");
  });

  it("should normalize a lowercase currency code to uppercase", async () => {
    const admin = await createTestUser("ADMIN");
    const { currency, reserve } =
      await createTestCurrencyWithReserve();

    const token = createAccessToken(admin);

    const response = await request(app)
      .get(
        `/api/v1/admin/currency-reserves/${currency.code.toLowerCase()}`,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.reserve.id).toBe(reserve.id);
    expect(response.body.data.reserve.currencyCode).toBe(
      currency.code,
    );
  });

  it("should include currency details in the reserve response", async () => {
    const admin = await createTestUser("ADMIN");
    const { currency } =
      await createTestCurrencyWithReserve();

    const token = createAccessToken(admin);

    const response = await request(app)
      .get(
        `/api/v1/admin/currency-reserves/${currency.code}`,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);

    const returnedReserve = response.body.data.reserve;

    expect(returnedReserve.currency.code).toBe(currency.code);
    expect(returnedReserve.currency.name).toBe(currency.name);
    expect(returnedReserve.currency.symbol).toBe(
      currency.symbol,
    );
    expect(returnedReserve.currency.decimalPlaces).toBe(
      currency.decimalPlaces,
    );
    expect(returnedReserve.currency.isActive).toBe(true);
  });

  it("should include requestId for an authorized reserve read", async () => {
    const admin = await createTestUser("ADMIN");
    const { currency } =
      await createTestCurrencyWithReserve();

    const token = createAccessToken(admin);

    const response = await request(app)
      .get(
        `/api/v1/admin/currency-reserves/${currency.code}`,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.requestId).toBeDefined();
    expect(typeof response.body.requestId).toBe("string");
    expect(response.body.requestId.length).toBeGreaterThan(0);
  });

  it("should allow ADMIN to list currency reserves with pagination", async () => {
    const admin = await createTestUser("ADMIN");

    await createTestCurrencyWithReserve();
    await createTestCurrencyWithReserve();
    await createTestCurrencyWithReserve();

    const token = createAccessToken(admin);

    const response = await request(app)
      .get(
        "/api/v1/admin/currency-reserves?page=1&limit=2",
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(response.body.data).toHaveProperty("reserves");
    expect(response.body.data).toHaveProperty("pagination");

    expect(Array.isArray(response.body.data.reserves)).toBe(
      true,
    );

    expect(
      response.body.data.reserves.length,
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

  it("should allow AUDITOR to list currency reserves", async () => {
    const auditor = await createTestUser("AUDITOR");

    await createTestCurrencyWithReserve();

    const token = createAccessToken(auditor);

    const response = await request(app)
      .get(
        "/api/v1/admin/currency-reserves?page=1&limit=10",
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data.reserves)).toBe(
      true,
    );
  });

  it("should reject SUPPORT from listing currency reserves", async () => {
    const support = await createTestUser("SUPPORT");

    const token = createAccessToken(support);

    const response = await request(app)
      .get(
        "/api/v1/admin/currency-reserves?page=1&limit=10",
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject CUSTOMER from listing currency reserves", async () => {
    const customer = await createTestUser("CUSTOMER");

    const token = createAccessToken(customer);

    const response = await request(app)
      .get(
        "/api/v1/admin/currency-reserves?page=1&limit=10",
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject invalid pagination parameters", async () => {
    const admin = await createTestUser("ADMIN");

    const token = createAccessToken(admin);

    const response = await request(app)
      .get(
        "/api/v1/admin/currency-reserves?page=0&limit=101",
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("BAD_REQUEST");
  });
});