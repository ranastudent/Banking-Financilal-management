import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";

const createdUserIds: string[] = [];
const createdTransactionIds: string[] = [];

const createTestUser = async (
  role: "CUSTOMER" | "ADMIN" | "SUPPORT" | "AUDITOR",
) => {
  const user = await prisma.user.create({
    data: {
      name: `Admin Transaction Test ${Date.now()}-${Math.random()}`,
      email: `admin-transaction-${Date.now()}-${Math.random()}@example.com`,
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

const createTestTransaction = async () => {
  const transaction = await prisma.transaction.create({
    data: {
      reference: `ADM-TEST-${Date.now()}-${Math.floor(
        100000 + Math.random() * 900000,
      )}`,
      type: "DEPOSIT",
      status: "COMPLETED",
      amount: 1000,
      currencyCode: "BDT",
      provider: "INTERNAL",
    },
  });

  createdTransactionIds.push(transaction.id);

  return transaction;
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
      jti: `test-jti-${Date.now()}-${Math.random()}`,
    },
    env.jwtRefreshSecret,
    {
      expiresIn: "7d",
    },
  );
};

afterEach(async () => {
  if (createdTransactionIds.length > 0) {
    await prisma.transaction.deleteMany({
      where: {
        id: {
          in: createdTransactionIds,
        },
      },
    });

    createdTransactionIds.length = 0;
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

describe("ADMIN Transaction Read Authorization", () => {
  it("should allow ADMIN to view a transaction by ID", async () => {
    const admin = await createTestUser("ADMIN");
    const transaction = await createTestTransaction();

    const token = createAccessToken(admin);

    const response = await request(app)
      .get(`/api/v1/admin/transactions/${transaction.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(response.body.data.transaction.id).toBe(transaction.id);
    expect(response.body.data.transaction.reference).toBe(
      transaction.reference,
    );
    expect(response.body.data.transaction.type).toBe(
      transaction.type,
    );
    expect(response.body.data.transaction.status).toBe(
      transaction.status,
    );
  });

  it("should reject CUSTOMER from viewing a transaction by ID", async () => {
    const customer = await createTestUser("CUSTOMER");
    const transaction = await createTestTransaction();

    const token = createAccessToken(customer);

    const response = await request(app)
      .get(`/api/v1/admin/transactions/${transaction.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject SUPPORT from viewing a transaction by ID", async () => {
    const support = await createTestUser("SUPPORT");
    const transaction = await createTestTransaction();

    const token = createAccessToken(support);

    const response = await request(app)
      .get(`/api/v1/admin/transactions/${transaction.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject AUDITOR from viewing a transaction by ID", async () => {
    const auditor = await createTestUser("AUDITOR");
    const transaction = await createTestTransaction();

    const token = createAccessToken(auditor);

    const response = await request(app)
      .get(`/api/v1/admin/transactions/${transaction.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject unauthenticated access to a transaction by ID", async () => {
    const transaction = await createTestTransaction();

    const response = await request(app).get(
      `/api/v1/admin/transactions/${transaction.id}`,
    );

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject a refresh token on the admin transaction route", async () => {
    const admin = await createTestUser("ADMIN");
    const transaction = await createTestTransaction();

    const refreshToken = createRefreshToken(admin);

    const response = await request(app)
      .get(`/api/v1/admin/transactions/${transaction.id}`)
      .set("Authorization", `Bearer ${refreshToken}`);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should return 404 when the requested transaction does not exist", async () => {
    const admin = await createTestUser("ADMIN");

    const token = createAccessToken(admin);

    const response = await request(app)
      .get(
        "/api/v1/admin/transactions/00000000-0000-0000-0000-000000000000",
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("should not expose internal metadata in a transaction response", async () => {
    const admin = await createTestUser("ADMIN");
    const transaction = await createTestTransaction();

    const token = createAccessToken(admin);

    const response = await request(app)
      .get(`/api/v1/admin/transactions/${transaction.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);

    const returnedTransaction = response.body.data.transaction;

    expect(returnedTransaction).not.toHaveProperty("metadata");
    expect(returnedTransaction).not.toHaveProperty("passwordHash");
    expect(returnedTransaction).not.toHaveProperty("accessToken");
    expect(returnedTransaction).not.toHaveProperty("refreshToken");
  });

  it("should include requestId for an authorized transaction read", async () => {
    const admin = await createTestUser("ADMIN");
    const transaction = await createTestTransaction();

    const token = createAccessToken(admin);

    const response = await request(app)
      .get(`/api/v1/admin/transactions/${transaction.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.requestId).toBeDefined();
    expect(typeof response.body.requestId).toBe("string");
    expect(response.body.requestId.length).toBeGreaterThan(0);
  });

  it("should allow ADMIN to list transactions with pagination", async () => {
    const admin = await createTestUser("ADMIN");

    await createTestTransaction();
    await createTestTransaction();
    await createTestTransaction();

    const token = createAccessToken(admin);

    const response = await request(app)
      .get("/api/v1/admin/transactions?page=1&limit=2")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(response.body.data).toHaveProperty("transactions");
    expect(response.body.data).toHaveProperty("pagination");

    expect(Array.isArray(response.body.data.transactions)).toBe(true);
    expect(response.body.data.transactions.length).toBeLessThanOrEqual(
      2,
    );

    expect(response.body.data.pagination.page).toBe(1);
    expect(response.body.data.pagination.limit).toBe(2);
    expect(typeof response.body.data.pagination.total).toBe("number");
    expect(typeof response.body.data.pagination.totalPages).toBe(
      "number",
    );
  });

  it("should reject invalid pagination parameters", async () => {
    const admin = await createTestUser("ADMIN");

    const token = createAccessToken(admin);

    const response = await request(app)
      .get("/api/v1/admin/transactions?page=0&limit=101")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("BAD_REQUEST");
  });
});