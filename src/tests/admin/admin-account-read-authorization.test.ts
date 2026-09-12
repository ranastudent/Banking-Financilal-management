import request from "supertest";
import { describe, expect, afterEach, it } from "vitest";
import jwt from "jsonwebtoken";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";

const createdUserIds: string[] = [];
const createdAccountIds: string[] = [];

const createTestUser = async (
  role: "CUSTOMER" | "ADMIN" | "SUPPORT" | "AUDITOR",
) => {
  const user = await prisma.user.create({
    data: {
      name: `Admin Account Test ${Date.now()}-${Math.random()}`,
      email: `admin-account-${Date.now()}-${Math.random()}@example.com`,
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

const createTestAccount = async (userId: string) => {
  const account = await prisma.account.create({
    data: {
      userId,
      accountNumber: `10${Date.now()}${Math.floor(
        100000 + Math.random() * 900000,
      )}`,
      accountType: "SAVINGS",
      status: "ACTIVE",
    },
  });

  createdAccountIds.push(account.id);

  return account;
};

const createAccessToken = (
  user: {
    id: string;
    email: string;
    role: string;
    status: string;
  },
) => {
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

const createRefreshToken = (
  user: {
    id: string;
  },
) => {
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
  if (createdAccountIds.length > 0) {
    await prisma.account.deleteMany({
      where: {
        id: {
          in: createdAccountIds,
        },
      },
    });

    createdAccountIds.length = 0;
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

describe("ADMIN Account Read Authorization", () => {
  it("should allow ADMIN to view an account by ID", async () => {
    const admin = await createTestUser("ADMIN");
    const customer = await createTestUser("CUSTOMER");
    const account = await createTestAccount(customer.id);

    const token = createAccessToken(admin);

    const response = await request(app)
      .get(`/api/v1/admin/accounts/${account.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(response.body.data.account.id).toBe(account.id);
    expect(response.body.data.account.accountNumber).toBe(
      account.accountNumber,
    );
    expect(response.body.data.account.user.id).toBe(customer.id);
  });

  it("should reject CUSTOMER from viewing an account by ID", async () => {
    const customer = await createTestUser("CUSTOMER");
    const targetUser = await createTestUser("CUSTOMER");
    const account = await createTestAccount(targetUser.id);

    const token = createAccessToken(customer);

    const response = await request(app)
      .get(`/api/v1/admin/accounts/${account.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject SUPPORT from viewing an account by ID", async () => {
    const support = await createTestUser("SUPPORT");
    const customer = await createTestUser("CUSTOMER");
    const account = await createTestAccount(customer.id);

    const token = createAccessToken(support);

    const response = await request(app)
      .get(`/api/v1/admin/accounts/${account.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject AUDITOR from viewing an account by ID", async () => {
    const auditor = await createTestUser("AUDITOR");
    const customer = await createTestUser("CUSTOMER");
    const account = await createTestAccount(customer.id);

    const token = createAccessToken(auditor);

    const response = await request(app)
      .get(`/api/v1/admin/accounts/${account.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject unauthenticated access to an account by ID", async () => {
    const customer = await createTestUser("CUSTOMER");
    const account = await createTestAccount(customer.id);

    const response = await request(app).get(
      `/api/v1/admin/accounts/${account.id}`,
    );

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject a refresh token on the admin account route", async () => {
    const admin = await createTestUser("ADMIN");
    const customer = await createTestUser("CUSTOMER");
    const account = await createTestAccount(customer.id);

    const refreshToken = createRefreshToken(admin);

    const response = await request(app)
      .get(`/api/v1/admin/accounts/${account.id}`)
      .set("Authorization", `Bearer ${refreshToken}`);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should return 404 when the requested account does not exist", async () => {
    const admin = await createTestUser("ADMIN");

    const token = createAccessToken(admin);

    const response = await request(app)
      .get(
        "/api/v1/admin/accounts/00000000-0000-0000-0000-000000000000",
      )
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("should not expose sensitive user fields in an account response", async () => {
    const admin = await createTestUser("ADMIN");
    const customer = await createTestUser("CUSTOMER");
    const account = await createTestAccount(customer.id);

    const token = createAccessToken(admin);

    const response = await request(app)
      .get(`/api/v1/admin/accounts/${account.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);

    const returnedAccount = response.body.data.account;
    const returnedUser = returnedAccount.user;

    expect(returnedAccount).not.toHaveProperty("passwordHash");
    expect(returnedUser).not.toHaveProperty("passwordHash");
    expect(returnedUser).not.toHaveProperty("password");
    expect(returnedUser).not.toHaveProperty("accessToken");
    expect(returnedUser).not.toHaveProperty("refreshToken");
  });

  it("should include requestId for an authorized account read", async () => {
    const admin = await createTestUser("ADMIN");
    const customer = await createTestUser("CUSTOMER");
    const account = await createTestAccount(customer.id);

    const token = createAccessToken(admin);

    const response = await request(app)
      .get(`/api/v1/admin/accounts/${account.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.requestId).toBeDefined();
    expect(typeof response.body.requestId).toBe("string");
    expect(response.body.requestId.length).toBeGreaterThan(0);
  });

  it("should allow ADMIN to list accounts with pagination", async () => {
    const admin = await createTestUser("ADMIN");
    const customer1 = await createTestUser("CUSTOMER");
    const customer2 = await createTestUser("CUSTOMER");
    const customer3 = await createTestUser("CUSTOMER");

    await createTestAccount(customer1.id);
    await createTestAccount(customer2.id);
    await createTestAccount(customer3.id);

    const token = createAccessToken(admin);

    const response = await request(app)
      .get("/api/v1/admin/accounts?page=1&limit=2")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(response.body.data).toHaveProperty("accounts");
    expect(response.body.data).toHaveProperty("pagination");

    expect(Array.isArray(response.body.data.accounts)).toBe(true);
    expect(response.body.data.accounts.length).toBeLessThanOrEqual(2);

    expect(response.body.data.pagination.page).toBe(1);
    expect(response.body.data.pagination.limit).toBe(2);
    expect(typeof response.body.data.pagination.total).toBe("number");
    expect(typeof response.body.data.pagination.totalPages).toBe("number");
  });

  it("should reject invalid pagination parameters", async () => {
    const admin = await createTestUser("ADMIN");

    const token = createAccessToken(admin);

    const response = await request(app)
      .get("/api/v1/admin/accounts?page=0&limit=101")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("BAD_REQUEST");
  });
});