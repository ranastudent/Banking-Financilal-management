import crypto from "node:crypto";

import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import app from "../../app";
import { prisma } from "../../config/prisma";
import * as emailService from "../../auth/services/email.service";

describe("GET /api/v1/users/me - User Profile Read", () => {
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

  it("should return the authenticated user's profile", async () => {
    const sendOtpSpy = vi
      .spyOn(emailService, "sendRegistrationOtpEmail")
      .mockResolvedValue(undefined);

    try {
      const email = createTestEmail("users-me");

      const registerResponse = await request(app)
        .post("/api/v1/auth/register")
        .send({
          name: "Profile Test User",
          email,
          password: userPassword,
        });

      expect(registerResponse.status).toBe(201);

      const user = await prisma.user.update({
        where: { email },
        data: {
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
        },
      });

      createdUserIds.push(user.id);

      const loginResponse = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email,
          password: userPassword,
        });

      expect(loginResponse.status).toBe(200);

      const accessToken = loginResponse.body.data.accessToken;

      const response = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", `Bearer ${accessToken}`);

      expect(response.status).toBe(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(
        expect.objectContaining({
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          status: user.status,
        }),
      );

      expect(response.body.data).not.toHaveProperty("passwordHash");

      expect(response.body.requestId).toEqual(expect.any(String));
    } finally {
      sendOtpSpy.mockRestore();
    }
  });

  it("should reject unauthenticated requests", async () => {
    const response = await request(app).get("/api/v1/users/me");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject an invalid access token", async () => {
    const response = await request(app)
      .get("/api/v1/users/me")
      .set("Authorization", "Bearer invalid-token");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject a refresh token used as an access token", async () => {
    const sendOtpSpy = vi
      .spyOn(emailService, "sendRegistrationOtpEmail")
      .mockResolvedValue(undefined);

    try {
      const email = createTestEmail("users-refresh-token");

      const registerResponse = await request(app)
        .post("/api/v1/auth/register")
        .send({
          name: "Refresh Token Test User",
          email,
          password: userPassword,
        });

      expect(registerResponse.status).toBe(201);

      const user = await prisma.user.update({
        where: { email },
        data: {
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
        },
      });

      createdUserIds.push(user.id);

      const loginResponse = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email,
          password: userPassword,
        });

      expect(loginResponse.status).toBe(200);

      const refreshToken = loginResponse.body.data.refreshToken;

      const response = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", `Bearer ${refreshToken}`);

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("UNAUTHORIZED");
    } finally {
      sendOtpSpy.mockRestore();
    }
  });
});