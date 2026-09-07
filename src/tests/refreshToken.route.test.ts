import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

import app from "../app";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { hashPassword } from "../auth/utils/password";
import {
  generateRefreshToken,
} from "../auth/utils/jwt";
import { hashRefreshToken } from "../auth/utils/refreshTokenHash";

describe("Refresh Token Route", () => {
  const password = "StrongPassword123!";

  beforeEach(async () => {
    await prisma.refreshToken.deleteMany({
      where: {
        user: {
          email: {
            startsWith: "refresh-route-",
          },
        },
      },
    });

    await prisma.emailVerificationOtp.deleteMany({
      where: {
        user: {
          email: {
            startsWith: "refresh-route-",
          },
        },
      },
    });

    await prisma.user.deleteMany({
      where: {
        email: {
          startsWith: "refresh-route-",
        },
      },
    });
  });

  const createUser = async (email: string) => {
    const passwordHash = await hashPassword(password);

    return prisma.user.create({
      data: {
        name: "Refresh Route User",
        email,
        passwordHash,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });
  };

  const createStoredRefreshToken = async (
    user: {
      id: string;
      email: string;
      role: string;
      status: string;
    },
  ) => {
    const refreshToken = generateRefreshToken({
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
    });

    const tokenHash = hashRefreshToken(refreshToken);

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000,
        ),
      },
    });

    return refreshToken;
  };

  it("should refresh tokens successfully", async () => {
    const email = `refresh-route-${Date.now()}@example.com`;

    const user = await createUser(email);
    const refreshToken = await createStoredRefreshToken(user);

    const response = await request(app)
      .post("/api/v1/auth/refresh")
      .send({
        refreshToken,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(response.body.data.user).toMatchObject({
      id: user.id,
      email,
      role: "CUSTOMER",
      status: "ACTIVE",
    });

    expect(response.body.data.accessToken).toBeTypeOf("string");
    expect(response.body.data.refreshToken).toBeTypeOf("string");

    expect(response.body.data.refreshToken).not.toBe(
      refreshToken,
    );

    expect(response.body.requestId).toBeDefined();

    const accessPayload = jwt.verify(
      response.body.data.accessToken,
      env.jwtAccessSecret,
    ) as jwt.JwtPayload;

    expect(accessPayload.sub).toBe(user.id);

    const refreshPayload = jwt.verify(
      response.body.data.refreshToken,
      env.jwtRefreshSecret,
    ) as jwt.JwtPayload;

    expect(refreshPayload.sub).toBe(user.id);
    expect(refreshPayload.tokenType).toBe("refresh");
    expect(refreshPayload.jti).toBeDefined();
  });

  it("should reject an invalid refresh token", async () => {
    const response = await request(app)
      .post("/api/v1/auth/refresh")
      .send({
        refreshToken: "invalid-refresh-token",
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject an access token", async () => {
    const email = `refresh-route-${Date.now()}@example.com`;

    const user = await createUser(email);

    const accessToken = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
      },
      env.jwtAccessSecret,
      {
        expiresIn: "15m",
      },
    );

    const response = await request(app)
      .post("/api/v1/auth/refresh")
      .send({
        refreshToken: accessToken,
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject a revoked refresh token", async () => {
    const email = `refresh-route-${Date.now()}@example.com`;

    const user = await createUser(email);
    const refreshToken = await createStoredRefreshToken(user);

    const tokenHash = hashRefreshToken(refreshToken);

    await prisma.refreshToken.updateMany({
      where: {
        tokenHash,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    const response = await request(app)
      .post("/api/v1/auth/refresh")
      .send({
        refreshToken,
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject a refresh request without a token", async () => {
    const response = await request(app)
      .post("/api/v1/auth/refresh")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});