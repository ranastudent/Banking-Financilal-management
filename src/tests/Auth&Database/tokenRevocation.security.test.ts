import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { prisma } from "../../config/prisma";
import app from "../../app";
import { generateRefreshToken } from "../../auth/utils/jwt";
import { hashRefreshToken } from "../../auth/utils/refreshTokenHash";
import { revokeRefreshToken } from "../../auth/services/token-revocation.service";

describe("Token Revocation Security", () => {
  let userId: string;
  let refreshToken: string;

  beforeEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.emailVerificationOtp.deleteMany();
    await prisma.user.deleteMany();

    const user = await prisma.user.create({
      data: {
        name: "Revocation Security User",
        email: `revocation-${Date.now()}@example.com`,
        passwordHash: "test-password-hash",
        role: "CUSTOMER",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });

    userId = user.id;

    refreshToken = generateRefreshToken({
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
    });

    await prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
  });

  afterEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.emailVerificationOtp.deleteMany();
    await prisma.user.deleteMany();
  });

  it("should block refresh after centralized token revocation", async () => {
    const revoked = await revokeRefreshToken(refreshToken);

    expect(revoked).toBe(true);

    const response = await request(app)
      .post("/api/v1/auth/refresh")
      .send({
        refreshToken,
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it("should not allow the same token to be revoked twice", async () => {
    const firstRevocation = await revokeRefreshToken(refreshToken);
    const secondRevocation = await revokeRefreshToken(refreshToken);

    expect(firstRevocation).toBe(true);
    expect(secondRevocation).toBe(false);
  });
});