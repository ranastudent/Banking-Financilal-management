import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { hashPassword } from "../../auth/utils/password";
import { generateRefreshToken } from "../../auth/utils/jwt";
import { hashRefreshToken } from "../../auth/utils/refreshTokenHash";

describe("Logout Route", () => {
  const password = "StrongPassword123!";

  beforeEach(async () => {
    await prisma.refreshToken.deleteMany({
      where: {
        user: {
          email: {
            startsWith: "logout-route-",
          },
        },
      },
    });

    await prisma.emailVerificationOtp.deleteMany({
      where: {
        user: {
          email: {
            startsWith: "logout-route-",
          },
        },
      },
    });

    await prisma.user.deleteMany({
      where: {
        email: {
          startsWith: "logout-route-",
        },
      },
    });
  });

  const createUser = async (email: string) => {
    const passwordHash = await hashPassword(password);

    return prisma.user.create({
      data: {
        name: "Logout Route User",
        email,
        passwordHash,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });
  };

  const createStoredRefreshToken = async (user: {
    id: string;
    email: string;
    role: string;
    status: string;
  }) => {
    const refreshToken = generateRefreshToken({
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
    });

    const tokenHash = hashRefreshToken(refreshToken);

    const record = await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000,
        ),
      },
    });

    return {
      refreshToken,
      record,
    };
  };

  it("should logout successfully with a valid refresh token", async () => {
    const email = `logout-route-${Date.now()}@example.com`;

    const user = await createUser(email);

    const { refreshToken, record } =
      await createStoredRefreshToken(user);

    const response = await request(app)
      .post("/api/v1/auth/logout")
      .send({
        refreshToken,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual({
      message: "Logout successful",
    });
    expect(response.body.requestId).toBeDefined();

    const revokedToken = await prisma.refreshToken.findUnique({
      where: {
        id: record.id,
      },
      select: {
        revokedAt: true,
      },
    });

    expect(revokedToken?.revokedAt).not.toBeNull();
  });

  it("should reject an invalid refresh token", async () => {
    const response = await request(app)
      .post("/api/v1/auth/logout")
      .send({
        refreshToken: "invalid-refresh-token",
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject an already revoked refresh token", async () => {
    const email = `logout-route-${Date.now()}@example.com`;

    const user = await createUser(email);

    const { refreshToken, record } =
      await createStoredRefreshToken(user);

    await prisma.refreshToken.update({
      where: {
        id: record.id,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    const response = await request(app)
      .post("/api/v1/auth/logout")
      .send({
        refreshToken,
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject a logout request without a refresh token", async () => {
    const response = await request(app)
      .post("/api/v1/auth/logout")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("should prevent the logged-out refresh token from being used again", async () => {
    const email = `logout-route-${Date.now()}@example.com`;

    const user = await createUser(email);

    const { refreshToken } =
      await createStoredRefreshToken(user);

    const logoutResponse = await request(app)
      .post("/api/v1/auth/logout")
      .send({
        refreshToken,
      });

    expect(logoutResponse.status).toBe(200);

    const refreshResponse = await request(app)
      .post("/api/v1/auth/refresh")
      .send({
        refreshToken,
      });

    expect(refreshResponse.status).toBe(401);
    expect(refreshResponse.body.success).toBe(false);
    expect(refreshResponse.body.error.code).toBe("UNAUTHORIZED");
  });
});