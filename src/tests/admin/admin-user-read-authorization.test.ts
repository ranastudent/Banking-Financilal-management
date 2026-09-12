import { describe, expect, it, afterEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";

const createdUserIds: string[] = [];

const createUser = async (
  role: "CUSTOMER" | "ADMIN" | "SUPPORT" | "AUDITOR",
) => {
  const user = await prisma.user.create({
    data: {
      name: `Admin User Test ${role}`,
      email: `admin-user-${role.toLowerCase()}-${crypto.randomUUID()}@example.com`,
      passwordHash: "test-password-hash",
      role,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });

  createdUserIds.push(user.id);

  return user;
};

const createAccessToken = (
  userId: string,
  email: string,
  role: string,
  status = "ACTIVE",
) => {
  return jwt.sign(
    {
      sub: userId,
      email,
      role,
      status,
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
      jti: crypto.randomUUID(),
    },
    env.jwtRefreshSecret,
    {
      expiresIn: "7d",
    },
  );
};

describe("ADMIN User Read Authorization", () => {
  afterEach(async () => {
    if (createdUserIds.length === 0) {
      return;
    }

    await prisma.user.deleteMany({
      where: {
        id: {
          in: createdUserIds,
        },
      },
    });

    createdUserIds.length = 0;
  });

  it("should allow ADMIN to view a user by ID", async () => {
    const admin = await createUser("ADMIN");
    const targetUser = await createUser("CUSTOMER");

    const token = createAccessToken(
      admin.id,
      admin.email,
      admin.role,
      admin.status,
    );

    const response = await request(app)
      .get(`/api/v1/admin/users/${targetUser.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user.id).toBe(targetUser.id);
    expect(response.body.data.user.email).toBe(targetUser.email);
  });

  it("should reject CUSTOMER from viewing a user by ID", async () => {
    const customer = await createUser("CUSTOMER");
    const targetUser = await createUser("CUSTOMER");

    const token = createAccessToken(
      customer.id,
      customer.email,
      customer.role,
      customer.status,
    );

    const response = await request(app)
      .get(`/api/v1/admin/users/${targetUser.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject SUPPORT from viewing a user by ID", async () => {
    const support = await createUser("SUPPORT");
    const targetUser = await createUser("CUSTOMER");

    const token = createAccessToken(
      support.id,
      support.email,
      support.role,
      support.status,
    );

    const response = await request(app)
      .get(`/api/v1/admin/users/${targetUser.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject AUDITOR from viewing a user by ID", async () => {
    const auditor = await createUser("AUDITOR");
    const targetUser = await createUser("CUSTOMER");

    const token = createAccessToken(
      auditor.id,
      auditor.email,
      auditor.role,
      auditor.status,
    );

    const response = await request(app)
      .get(`/api/v1/admin/users/${targetUser.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject unauthenticated access to a user by ID", async () => {
    const targetUser = await createUser("CUSTOMER");

    const response = await request(app).get(
      `/api/v1/admin/users/${targetUser.id}`,
    );

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject a refresh token on the admin user route", async () => {
    const customer = await createUser("CUSTOMER");

    const refreshToken = createRefreshToken(customer.id);

    const response = await request(app)
      .get(`/api/v1/admin/users/${customer.id}`)
      .set("Authorization", `Bearer ${refreshToken}`);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should return 404 when the requested user does not exist", async () => {
    const admin = await createUser("ADMIN");

    const token = createAccessToken(
      admin.id,
      admin.email,
      admin.role,
      admin.status,
    );

    const missingUserId = "00000000-0000-0000-0000-000000000000";

    const response = await request(app)
      .get(`/api/v1/admin/users/${missingUserId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("should not expose passwordHash in a user response", async () => {
    const admin = await createUser("ADMIN");
    const targetUser = await createUser("CUSTOMER");

    const token = createAccessToken(
      admin.id,
      admin.email,
      admin.role,
      admin.status,
    );

    const response = await request(app)
      .get(`/api/v1/admin/users/${targetUser.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.user).not.toHaveProperty("passwordHash");
    expect(response.body.data.user).not.toHaveProperty("password");
  });

  it("should include requestId for an authorized user read", async () => {
    const admin = await createUser("ADMIN");
    const targetUser = await createUser("CUSTOMER");

    const token = createAccessToken(
      admin.id,
      admin.email,
      admin.role,
      admin.status,
    );

    const response = await request(app)
      .get(`/api/v1/admin/users/${targetUser.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.requestId).toBeDefined();
    expect(typeof response.body.requestId).toBe("string");
  });

  it("should allow ADMIN to list users with pagination", async () => {
    const admin = await createUser("ADMIN");
    await createUser("CUSTOMER");
    await createUser("SUPPORT");
    await createUser("AUDITOR");

    const token = createAccessToken(
      admin.id,
      admin.email,
      admin.role,
      admin.status,
    );

    const response = await request(app)
      .get("/api/v1/admin/users?page=1&limit=2")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(response.body.data).toHaveProperty("users");
    expect(response.body.data).toHaveProperty("pagination");

    expect(Array.isArray(response.body.data.users)).toBe(true);
    expect(response.body.data.users.length).toBeLessThanOrEqual(2);

    expect(response.body.data.pagination.page).toBe(1);
    expect(response.body.data.pagination.limit).toBe(2);
    expect(typeof response.body.data.pagination.total).toBe("number");
    expect(typeof response.body.data.pagination.totalPages).toBe("number");
  });

  it("should reject invalid pagination parameters", async () => {
    const admin = await createUser("ADMIN");

    const token = createAccessToken(
      admin.id,
      admin.email,
      admin.role,
      admin.status,
    );

    const response = await request(app)
      .get("/api/v1/admin/users?page=0&limit=101")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("BAD_REQUEST");
  });
});