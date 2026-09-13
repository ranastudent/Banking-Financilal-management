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
      name: `Reserve Adjustment Test ${Date.now()}-${Math.random()}`,
      email: `reserve-adjustment-${Date.now()}-${Math.random()}@example.com`,
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

const createTestCurrencyReserve = async (
  availableReserve = "10000",
  lockedReserve = "1000",
  minimumReserve = "2000",
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
      name: `Reserve Test Currency ${currencyCode}`,
      symbol: "T",
      decimalPlaces: 2,
      isActive: true,
    },
  });

  createdCurrencyCodes.push(currency.code);

  const reserve = await prisma.currencyReserve.create({
    data: {
      currencyCode: currency.code,
      availableReserve,
      lockedReserve,
      minimumReserve,
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

const createRefreshToken = (user: { id: string }) => {
  return jwt.sign(
    {
      sub: user.id,
      tokenType: "refresh",
      jti: `reserve-adjustment-jti-${Date.now()}-${Math.random()}`,
    },
    env.jwtRefreshSecret,
    {
      expiresIn: "7d",
    },
  );
};

afterEach(async () => {
  const reserveIdsToDelete = [...createdReserveIds];
  const currencyCodesToDelete = [...createdCurrencyCodes];

  if (reserveIdsToDelete.length > 0) {
    await prisma.reserveMovement.deleteMany({
      where: {
        reserveId: {
          in: reserveIdsToDelete,
        },
      },
    });

    await prisma.auditLog.deleteMany({
      where: {
        entityType: "CURRENCY_RESERVE",
        entityId: {
          in: reserveIdsToDelete,
        },
      },
    });

    await prisma.currencyReserve.deleteMany({
      where: {
        id: {
          in: reserveIdsToDelete,
        },
      },
    });
  }

  if (currencyCodesToDelete.length > 0) {
    await prisma.currency.deleteMany({
      where: {
        code: {
          in: currencyCodesToDelete,
        },
      },
    });
  }

  createdReserveIds.length = 0;
  createdCurrencyCodes.length = 0;

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

describe("ADMIN Currency Reserve Adjustment Authorization", () => {
  it("should allow ADMIN to increase a currency reserve", async () => {
    const admin = await createTestUser("ADMIN");
    const { currency } = await createTestCurrencyReserve();

    const token = createAccessToken(admin);

    const response = await request(app)
      .post(
        `/api/v1/admin/currency-reserves/${currency.code}/adjust`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        amount: "500",
        direction: "INCREASE",
        reason: "Test reserve funding",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(
      response.body.data.reserve.availableReserve,
    ).toBe("10500");

    const reserve = await prisma.currencyReserve.findUnique({
      where: {
        currencyCode: currency.code,
      },
    });

    expect(reserve?.availableReserve.toString()).toBe("10500");
  });

  it("should allow ADMIN to decrease a currency reserve", async () => {
    const admin = await createTestUser("ADMIN");
    const { currency } = await createTestCurrencyReserve();

    const token = createAccessToken(admin);

    const response = await request(app)
      .post(
        `/api/v1/admin/currency-reserves/${currency.code}/adjust`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        amount: "500",
        direction: "DECREASE",
        reason: "Test reserve correction",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(
      response.body.data.reserve.availableReserve,
    ).toBe("9500");

    const reserve = await prisma.currencyReserve.findUnique({
      where: {
        currencyCode: currency.code,
      },
    });

    expect(reserve?.availableReserve.toString()).toBe("9500");
  });

  it("should reject CUSTOMER from adjusting a currency reserve", async () => {
    const customer = await createTestUser("CUSTOMER");
    const { currency } = await createTestCurrencyReserve();

    const token = createAccessToken(customer);

    const response = await request(app)
      .post(
        `/api/v1/admin/currency-reserves/${currency.code}/adjust`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        amount: "500",
        direction: "INCREASE",
        reason: "Unauthorized test",
      });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject SUPPORT from adjusting a currency reserve", async () => {
    const support = await createTestUser("SUPPORT");
    const { currency } = await createTestCurrencyReserve();

    const token = createAccessToken(support);

    const response = await request(app)
      .post(
        `/api/v1/admin/currency-reserves/${currency.code}/adjust`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        amount: "500",
        direction: "INCREASE",
        reason: "Unauthorized test",
      });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject AUDITOR from adjusting a currency reserve", async () => {
    const auditor = await createTestUser("AUDITOR");
    const { currency } = await createTestCurrencyReserve();

    const token = createAccessToken(auditor);

    const response = await request(app)
      .post(
        `/api/v1/admin/currency-reserves/${currency.code}/adjust`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        amount: "500",
        direction: "INCREASE",
        reason: "Unauthorized test",
      });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject unauthenticated reserve adjustment", async () => {
    const { currency } = await createTestCurrencyReserve();

    const response = await request(app)
      .post(
        `/api/v1/admin/currency-reserves/${currency.code}/adjust`,
      )
      .send({
        amount: "500",
        direction: "INCREASE",
        reason: "Unauthenticated test",
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject a refresh token for reserve adjustment", async () => {
    const admin = await createTestUser("ADMIN");
    const { currency } = await createTestCurrencyReserve();

    const refreshToken = createRefreshToken(admin);

    const response = await request(app)
      .post(
        `/api/v1/admin/currency-reserves/${currency.code}/adjust`,
      )
      .set("Authorization", `Bearer ${refreshToken}`)
      .send({
        amount: "500",
        direction: "INCREASE",
        reason: "Refresh token test",
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject a missing amount", async () => {
    const admin = await createTestUser("ADMIN");
    const { currency } = await createTestCurrencyReserve();

    const token = createAccessToken(admin);

    const response = await request(app)
      .post(
        `/api/v1/admin/currency-reserves/${currency.code}/adjust`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        direction: "INCREASE",
        reason: "Missing amount test",
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("should reject zero adjustment amount", async () => {
    const admin = await createTestUser("ADMIN");
    const { currency } = await createTestCurrencyReserve();

    const token = createAccessToken(admin);

    const response = await request(app)
      .post(
        `/api/v1/admin/currency-reserves/${currency.code}/adjust`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        amount: "0",
        direction: "INCREASE",
        reason: "Zero amount test",
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("should reject a negative adjustment amount", async () => {
    const admin = await createTestUser("ADMIN");
    const { currency } = await createTestCurrencyReserve();

    const token = createAccessToken(admin);

    const response = await request(app)
      .post(
        `/api/v1/admin/currency-reserves/${currency.code}/adjust`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        amount: "-100",
        direction: "INCREASE",
        reason: "Negative amount test",
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("should reject an invalid direction", async () => {
    const admin = await createTestUser("ADMIN");
    const { currency } = await createTestCurrencyReserve();

    const token = createAccessToken(admin);

    const response = await request(app)
      .post(
        `/api/v1/admin/currency-reserves/${currency.code}/adjust`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        amount: "500",
        direction: "INVALID",
        reason: "Invalid direction test",
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("should reject an empty reason", async () => {
    const admin = await createTestUser("ADMIN");
    const { currency } = await createTestCurrencyReserve();

    const token = createAccessToken(admin);

    const response = await request(app)
      .post(
        `/api/v1/admin/currency-reserves/${currency.code}/adjust`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        amount: "500",
        direction: "INCREASE",
        reason: "",
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("should reject an invalid currency code", async () => {
    const admin = await createTestUser("ADMIN");

    const token = createAccessToken(admin);

    const response = await request(app)
      .post(
        "/api/v1/admin/currency-reserves/USDT/adjust",
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        amount: "500",
        direction: "INCREASE",
        reason: "Invalid currency test",
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("BAD_REQUEST");
  });

  it("should return 404 when the currency reserve does not exist", async () => {
    const admin = await createTestUser("ADMIN");

    const token = createAccessToken(admin);

    const response = await request(app)
      .post(
        "/api/v1/admin/currency-reserves/ZZZ/adjust",
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        amount: "500",
        direction: "INCREASE",
        reason: "Missing reserve test",
      });

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "RESOURCE_NOT_FOUND",
    );
  });

  it("should reject a decrease that would make the reserve negative", async () => {
    const admin = await createTestUser("ADMIN");
    const { currency } = await createTestCurrencyReserve(
      "1000",
      "0",
      "0",
    );

    const token = createAccessToken(admin);

    const response = await request(app)
      .post(
        `/api/v1/admin/currency-reserves/${currency.code}/adjust`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        amount: "1001",
        direction: "DECREASE",
        reason: "Negative reserve protection test",
      });

    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("CONFLICT");

    const reserve = await prisma.currencyReserve.findUnique({
      where: {
        currencyCode: currency.code,
      },
    });

    expect(reserve?.availableReserve.toString()).toBe("1000");
  });

  it("should reject a decrease below the minimum reserve", async () => {
    const admin = await createTestUser("ADMIN");
    const { currency } = await createTestCurrencyReserve(
      "10000",
      "0",
      "2000",
    );

    const token = createAccessToken(admin);

    const response = await request(app)
      .post(
        `/api/v1/admin/currency-reserves/${currency.code}/adjust`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        amount: "8001",
        direction: "DECREASE",
        reason: "Minimum reserve protection test",
      });

    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("CONFLICT");

    const reserve = await prisma.currencyReserve.findUnique({
      where: {
        currencyCode: currency.code,
      },
    });

    expect(reserve?.availableReserve.toString()).toBe(
      "10000",
    );
  });

  it("should create a reserve movement after a successful increase", async () => {
    const admin = await createTestUser("ADMIN");
    const { currency, reserve } =
      await createTestCurrencyReserve();

    const token = createAccessToken(admin);

    const response = await request(app)
      .post(
        `/api/v1/admin/currency-reserves/${currency.code}/adjust`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        amount: "500",
        direction: "INCREASE",
        reason: "Movement creation test",
      });

    expect(response.status).toBe(200);

    const movement = await prisma.reserveMovement.findFirst({
      where: {
        reserveId: reserve.id,
        currencyCode: currency.code,
        movementType: "ADMIN_ADJUSTMENT",
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    expect(movement).not.toBeNull();
    expect(movement?.amount.toString()).toBe("500");
    expect(movement?.balanceBefore.toString()).toBe(
      "10000",
    );
    expect(movement?.balanceAfter.toString()).toBe(
      "10500",
    );
  });

  it("should create an audit log after a successful reserve adjustment", async () => {
    const admin = await createTestUser("ADMIN");
    const { currency, reserve } =
      await createTestCurrencyReserve();

    const token = createAccessToken(admin);

    const response = await request(app)
      .post(
        `/api/v1/admin/currency-reserves/${currency.code}/adjust`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        amount: "500",
        direction: "INCREASE",
        reason: "Audit log creation test",
      });

    expect(response.status).toBe(200);

    const auditLog = await prisma.auditLog.findFirst({
      where: {
        action: "CURRENCY_RESERVE_ADJUSTED",
        entityType: "CURRENCY_RESERVE",
        entityId: reserve.id,
        userId: admin.id,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    expect(auditLog).not.toBeNull();

    expect(auditLog?.metadata).toEqual({
      currencyCode: currency.code,
      amount: "500",
      direction: "INCREASE",
      reason: "Audit log creation test",
      balanceBefore: "10000",
      balanceAfter: "10500",
      minimumReserve: "2000",
    });
  });

  it("should include requestId after a successful reserve adjustment", async () => {
    const admin = await createTestUser("ADMIN");
    const { currency } = await createTestCurrencyReserve();

    const token = createAccessToken(admin);

    const response = await request(app)
      .post(
        `/api/v1/admin/currency-reserves/${currency.code}/adjust`,
      )
      .set("Authorization", `Bearer ${token}`)
      .send({
        amount: "500",
        direction: "INCREASE",
        reason: "Request ID test",
      });

    expect(response.status).toBe(200);
    expect(response.body.requestId).toBeDefined();
    expect(typeof response.body.requestId).toBe("string");
    expect(response.body.requestId.length).toBeGreaterThan(0);
  });
});