import crypto from "node:crypto";

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { hashPassword } from "../../auth/utils/password";
import {
  generateAccessToken,
  generateRefreshToken,
} from "../../auth/utils/jwt";
import type { AuthUser } from "../../types/auth";

describe("PATCH /api/v1/users/me - User Profile Update", () => {
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

  const createAuthenticatedUser = async () => {
    const email = createTestEmail("profile-update");
    const passwordHash = await hashPassword(userPassword);

    const user = await prisma.user.create({
      data: {
        name: "Profile Update User",
        email,
        passwordHash,
        role: "CUSTOMER",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });

    createdUserIds.push(user.id);

    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
    };

    const accessToken = generateAccessToken(authUser);
    const refreshToken = generateRefreshToken(authUser);

    return {
      user,
      accessToken,
      refreshToken,
    };
  };

  it("should update the user's name", async () => {
    const { user, accessToken } =
      await createAuthenticatedUser();

    const response = await request(app)
      .patch("/api/v1/users/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        name: "Updated User Name",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(response.body.data).toEqual(
      expect.objectContaining({
        id: user.id,
        name: "Updated User Name",
        email: user.email,
      }),
    );

    expect(response.body.data).not.toHaveProperty("passwordHash");
    expect(response.body.requestId).toEqual(
      expect.any(String),
    );
  });

  it("should update the user's phone number", async () => {
    const { user, accessToken } =
      await createAuthenticatedUser();

    const response = await request(app)
      .patch("/api/v1/users/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        phone: "01712345678",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.phone).toBe(
      "01712345678",
    );

    const updatedUser = await prisma.user.findUnique({
      where: {
        id: user.id,
      },
      select: {
        phone: true,
      },
    });

    expect(updatedUser?.phone).toBe(
      "01712345678",
    );
  });

  it("should update both name and phone", async () => {
    const { accessToken } =
      await createAuthenticatedUser();

    const response = await request(app)
      .patch("/api/v1/users/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        name: "Complete Updated Name",
        phone: "01812345678",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.name).toBe(
      "Complete Updated Name",
    );
    expect(response.body.data.phone).toBe(
      "01812345678",
    );
  });

  it("should allow the user to clear the phone number", async () => {
    const { accessToken } =
      await createAuthenticatedUser();

    const setPhoneResponse = await request(app)
      .patch("/api/v1/users/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        phone: "01912345678",
      });

    expect(setPhoneResponse.status).toBe(200);

    const clearPhoneResponse = await request(app)
      .patch("/api/v1/users/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        phone: null,
      });

    expect(clearPhoneResponse.status).toBe(200);
    expect(clearPhoneResponse.body.success).toBe(
      true,
    );
    expect(clearPhoneResponse.body.data.phone).toBeNull();
  });

  it("should reject an empty update body", async () => {
    const { accessToken } =
      await createAuthenticatedUser();

    const response = await request(app)
      .patch("/api/v1/users/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it("should reject an invalid name", async () => {
    const { accessToken } =
      await createAuthenticatedUser();

    const response = await request(app)
      .patch("/api/v1/users/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        name: "A",
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("should reject unsupported fields", async () => {
    const { accessToken } =
      await createAuthenticatedUser();

    const response = await request(app)
      .patch("/api/v1/users/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        role: "ADMIN",
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("should reject status modification", async () => {
    const { accessToken } =
      await createAuthenticatedUser();

    const response = await request(app)
      .patch("/api/v1/users/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        status: "BLOCKED",
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("should reject email modification", async () => {
    const { accessToken } =
      await createAuthenticatedUser();

    const response = await request(app)
      .patch("/api/v1/users/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        email: "attacker@example.com",
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("should reject passwordHash modification", async () => {
    const { accessToken } =
      await createAuthenticatedUser();

    const response = await request(app)
      .patch("/api/v1/users/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        passwordHash: "malicious-hash",
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("should reject unauthenticated requests", async () => {
    const response = await request(app)
      .patch("/api/v1/users/me")
      .send({
        name: "Unauthorized Update",
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "UNAUTHORIZED",
    );
  });

  it("should reject an invalid access token", async () => {
    const response = await request(app)
      .patch("/api/v1/users/me")
      .set(
        "Authorization",
        "Bearer invalid-token",
      )
      .send({
        name: "Invalid Token Update",
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "UNAUTHORIZED",
    );
  });

  it("should reject a refresh token used as an access token", async () => {
    const { refreshToken } =
      await createAuthenticatedUser();

    const response = await request(app)
      .patch("/api/v1/users/me")
      .set(
        "Authorization",
        `Bearer ${refreshToken}`,
      )
      .send({
        name: "Refresh Token Attack",
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "UNAUTHORIZED",
    );
  });

  it("should preserve role and status when profile is updated", async () => {
    const { user, accessToken } =
      await createAuthenticatedUser();

    const response = await request(app)
      .patch("/api/v1/users/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        name: "Role Safety User",
        phone: "01612345678",
      });

    expect(response.status).toBe(200);

    const updatedUser =
      await prisma.user.findUnique({
        where: {
          id: user.id,
        },
        select: {
          role: true,
          status: true,
        },
      });

    expect(updatedUser).toEqual({
      role: user.role,
      status: user.status,
    });
  });

  it("should prevent one user from changing another user's profile", async () => {
    const first =
      await createAuthenticatedUser();

    const secondEmail =
      createTestEmail("other-user");

    const secondPasswordHash =
      await hashPassword(userPassword);

    const secondUser =
      await prisma.user.create({
        data: {
          name: "Other User",
          email: secondEmail,
          passwordHash: secondPasswordHash,
          role: "CUSTOMER",
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
        },
      });

    createdUserIds.push(secondUser.id);

    const response = await request(app)
      .patch("/api/v1/users/me")
      .set(
        "Authorization",
        `Bearer ${first.accessToken}`,
      )
      .send({
        name: "Attempted Other User Update",
      });

    expect(response.status).toBe(200);

    const secondUserAfterRequest =
      await prisma.user.findUnique({
        where: {
          id: secondUser.id,
        },
        select: {
          name: true,
        },
      });

    expect(
      secondUserAfterRequest?.name,
    ).toBe("Other User");
  });
});