import crypto from "node:crypto";

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { generateAccessToken, generateRefreshToken, } from "../../auth/utils/jwt";
import {
  UserRole,
  UserStatus,
} from "@prisma/client";
import { hashPassword } from "../../auth/utils/password";
import type { AuthUser } from "../../types/auth";


describe("PATCH /api/v1/admin/users/:userId/status - Admin User Status", () => {
  const userPassword = "StrongPassword123!";

  const createdUserIds: string[] = [];

  const createTestEmail = (label: string) =>
    `${label}.${crypto.randomUUID()}@example.com`;

  afterEach(async () => {
    if (createdUserIds.length === 0) {
      return;
    }

    const userIds = [...createdUserIds];
    createdUserIds.length = 0;

    await prisma.refreshToken.deleteMany({
      where: {
        userId: {
          in: userIds,
        },
      },
    });

    await prisma.emailVerificationOtp.deleteMany({
      where: {
        userId: {
          in: userIds,
        },
      },
    });

    await prisma.user.deleteMany({
      where: {
        id: {
          in: userIds,
        },
      },
    });
  });

  const createUser = async (
    role: "CUSTOMER" | "ADMIN" | "SUPPORT" | "AUDITOR" = "CUSTOMER",
    status: "ACTIVE" | "BLOCKED" | "SUSPENDED" = "ACTIVE",
  ) => {
    const email = createTestEmail("admin-status");
    const passwordHash = await hashPassword(userPassword);

    const user = await prisma.user.create({
      data: {
        name: "Status Test User",
        email,
        passwordHash,
        role,
        status,
        emailVerifiedAt: new Date(),
      },
    });

    createdUserIds.push(user.id);

    return user;
  };

  const createAccessToken = (
    user: {
        id: string;
        email: string;
        role: UserRole;
        status: UserStatus;
    },
    ) => {
    if (user.status === "INACTIVE") {
        throw new Error(
        "INACTIVE users cannot be used for access-token test setup",
        );
    }

    const authUser: AuthUser = {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
    };

    return generateAccessToken(authUser);
  };

  it("should allow ADMIN to change a user's status to ACTIVE", async () => {
    const admin = await createUser("ADMIN", "ACTIVE");
    const target = await createUser("CUSTOMER", "BLOCKED");

    const accessToken = createAccessToken(admin);

    const response = await request(app)
      .patch(`/api/v1/admin/users/${target.id}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        status: "ACTIVE",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.id).toBe(target.id);
    expect(response.body.data.status).toBe("ACTIVE");

    const updatedUser = await prisma.user.findUnique({
      where: {
        id: target.id,
      },
      select: {
        status: true,
      },
    });

    expect(updatedUser?.status).toBe("ACTIVE");
  });

  it("should allow ADMIN to change a user's status to BLOCKED", async () => {
    const admin = await createUser("ADMIN", "ACTIVE");
    const target = await createUser("CUSTOMER", "ACTIVE");

    const accessToken = createAccessToken(admin);

    const response = await request(app)
      .patch(`/api/v1/admin/users/${target.id}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        status: "BLOCKED",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe("BLOCKED");

    const updatedUser = await prisma.user.findUnique({
      where: {
        id: target.id,
      },
      select: {
        status: true,
      },
    });

    expect(updatedUser?.status).toBe("BLOCKED");
  });

  it("should allow ADMIN to change a user's status to SUSPENDED", async () => {
    const admin = await createUser("ADMIN", "ACTIVE");
    const target = await createUser("CUSTOMER", "ACTIVE");

    const accessToken = createAccessToken(admin);

    const response = await request(app)
      .patch(`/api/v1/admin/users/${target.id}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        status: "SUSPENDED",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe("SUSPENDED");

    const updatedUser = await prisma.user.findUnique({
      where: {
        id: target.id,
      },
      select: {
        status: true,
      },
    });

    expect(updatedUser?.status).toBe("SUSPENDED");
  });

  it("should reject CUSTOMER access", async () => {
    const customer = await createUser("CUSTOMER", "ACTIVE");
    const target = await createUser("CUSTOMER", "ACTIVE");

    const accessToken = createAccessToken(customer);

    const response = await request(app)
      .patch(`/api/v1/admin/users/${target.id}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        status: "BLOCKED",
      });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject SUPPORT access", async () => {
    const support = await createUser("SUPPORT", "ACTIVE");
    const target = await createUser("CUSTOMER", "ACTIVE");

    const accessToken = createAccessToken(support);

    const response = await request(app)
      .patch(`/api/v1/admin/users/${target.id}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        status: "BLOCKED",
      });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject AUDITOR access", async () => {
    const auditor = await createUser("AUDITOR", "ACTIVE");
    const target = await createUser("CUSTOMER", "ACTIVE");

    const accessToken = createAccessToken(auditor);

    const response = await request(app)
      .patch(`/api/v1/admin/users/${target.id}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        status: "BLOCKED",
      });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("should reject unauthenticated requests", async () => {
    const target = await createUser("CUSTOMER", "ACTIVE");

    const response = await request(app)
      .patch(`/api/v1/admin/users/${target.id}/status`)
      .send({
        status: "BLOCKED",
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject an invalid access token", async () => {
    const target = await createUser("CUSTOMER", "ACTIVE");

    const response = await request(app)
      .patch(`/api/v1/admin/users/${target.id}/status`)
      .set("Authorization", "Bearer invalid-token")
      .send({
        status: "BLOCKED",
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject a refresh token used as an access token", async () => {
    const admin = await createUser("ADMIN", "ACTIVE");
    const target = await createUser("CUSTOMER", "ACTIVE");

    const authUser: AuthUser = {
      id: admin.id,
      email: admin.email,
      role: admin.role,
      status: admin.status,
    };

    const refreshToken = generateRefreshToken(authUser);

    const response = await request(app)
      .patch(`/api/v1/admin/users/${target.id}/status`)
      .set("Authorization", `Bearer ${refreshToken}`)
      .send({
        status: "BLOCKED",
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject INACTIVE status", async () => {
    const admin = await createUser("ADMIN", "ACTIVE");
    const target = await createUser("CUSTOMER", "ACTIVE");

    const accessToken = createAccessToken(admin);

    const response = await request(app)
      .patch(`/api/v1/admin/users/${target.id}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        status: "INACTIVE",
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("should reject an invalid status", async () => {
    const admin = await createUser("ADMIN", "ACTIVE");
    const target = await createUser("CUSTOMER", "ACTIVE");

    const accessToken = createAccessToken(admin);

    const response = await request(app)
      .patch(`/api/v1/admin/users/${target.id}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        status: "INVALID_STATUS",
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("should reject missing status", async () => {
    const admin = await createUser("ADMIN", "ACTIVE");
    const target = await createUser("CUSTOMER", "ACTIVE");

    const accessToken = createAccessToken(admin);

    const response = await request(app)
      .patch(`/api/v1/admin/users/${target.id}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("should reject unknown fields", async () => {
    const admin = await createUser("ADMIN", "ACTIVE");
    const target = await createUser("CUSTOMER", "ACTIVE");

    const accessToken = createAccessToken(admin);

    const response = await request(app)
      .patch(`/api/v1/admin/users/${target.id}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        status: "BLOCKED",
        role: "ADMIN",
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("should return 404 for an unknown user", async () => {
    const admin = await createUser("ADMIN", "ACTIVE");
    const accessToken = createAccessToken(admin);

    const unknownUserId = crypto.randomUUID();

    const response = await request(app)
      .patch(`/api/v1/admin/users/${unknownUserId}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        status: "BLOCKED",
      });

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("should return the updated user without passwordHash", async () => {
    const admin = await createUser("ADMIN", "ACTIVE");
    const target = await createUser("CUSTOMER", "ACTIVE");

    const accessToken = createAccessToken(admin);

    const response = await request(app)
      .patch(`/api/v1/admin/users/${target.id}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        status: "BLOCKED",
      });

    expect(response.status).toBe(200);
    expect(response.body.data).not.toHaveProperty("passwordHash");
    expect(response.body.requestId).toEqual(expect.any(String));
  });

  it("should keep the target user's role unchanged", async () => {
    const admin = await createUser("ADMIN", "ACTIVE");
    const target = await createUser("CUSTOMER", "ACTIVE");

    const accessToken = createAccessToken(admin);

    const response = await request(app)
      .patch(`/api/v1/admin/users/${target.id}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        status: "BLOCKED",
      });

    expect(response.status).toBe(200);

    const updatedUser = await prisma.user.findUnique({
      where: {
        id: target.id,
      },
      select: {
        role: true,
        status: true,
      },
    });

    expect(updatedUser).toEqual({
      role: "CUSTOMER",
      status: "BLOCKED",
    });
  });
});