import { beforeEach, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";

import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { hashPassword } from "../../auth/utils/password";
import {
  generateRefreshToken,
} from "../../auth/utils/jwt";
import { hashRefreshToken } from "../../auth/utils/refreshTokenHash";
import { refreshAccessToken } from "../../auth/services/refresh-token.service";

describe("Refresh Token Service", () => {
  const password = "StrongPassword123!";

  beforeEach(async () => {
    await prisma.refreshToken.deleteMany({
      where: {
        user: {
          email: {
            startsWith: "refresh-test-",
          },
        },
      },
    });

    await prisma.user.deleteMany({
      where: {
        email: {
          startsWith: "refresh-test-",
        },
      },
    });
  });

  const createUser = async ({
    email,
    status = "ACTIVE",
    emailVerifiedAt = new Date(),
  }: {
    email: string;
    status?: "ACTIVE" | "INACTIVE";
    emailVerifiedAt?: Date | null;
  }) => {
    const passwordHash = await hashPassword(password);

    return prisma.user.create({
      data: {
        name: "Refresh Test User",
        email,
        passwordHash,
        status,
        emailVerifiedAt,
      },
    });
  };

  const createStoredRefreshToken = async (
    userId: string,
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

    const expiresAt = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000,
    );

    const record = await prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
      },
    });

    return {
      refreshToken,
      record,
    };
  };

  it("should refresh access token and rotate refresh token", async () => {
    const email = `refresh-test-${Date.now()}@example.com`;

    const user = await createUser({
      email,
    });

    const { refreshToken, record } = await createStoredRefreshToken(
      user.id,
      user,
    );

    const result = await refreshAccessToken({
      refreshToken,
    });

    expect(result.user.id).toBe(user.id);
    expect(result.user.email).toBe(email);
    expect(result.user.status).toBe("ACTIVE");

    expect(result.accessToken).toBeTypeOf("string");
    expect(result.refreshToken).toBeTypeOf("string");

    expect(result.refreshToken).not.toBe(refreshToken);

    const accessPayload = jwt.verify(
      result.accessToken,
      env.jwtAccessSecret,
    ) as jwt.JwtPayload;

    expect(accessPayload.sub).toBe(user.id);

    const newRefreshPayload = jwt.verify(
      result.refreshToken,
      env.jwtRefreshSecret,
    ) as jwt.JwtPayload;

    expect(newRefreshPayload.sub).toBe(user.id);
    expect(newRefreshPayload.tokenType).toBe("refresh");

    const oldToken = await prisma.refreshToken.findUnique({
      where: {
        id: record.id,
      },
      select: {
        revokedAt: true,
      },
    });

    expect(oldToken?.revokedAt).not.toBeNull();

    const newTokenHash = hashRefreshToken(
      result.refreshToken,
    );

    const newToken = await prisma.refreshToken.findFirst({
      where: {
        userId: user.id,
        tokenHash: newTokenHash,
      },
    });

    expect(newToken).not.toBeNull();
    expect(newToken?.revokedAt).toBeNull();
    expect(newToken?.expiresAt.getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it("should reject an invalid refresh token", async () => {
    await expect(
      refreshAccessToken({
        refreshToken: "invalid-refresh-token",
      }),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: "UNAUTHORIZED",
    });
  });

  it("should reject an access token as a refresh token", async () => {
    const email = `refresh-test-${Date.now()}@example.com`;

    const user = await createUser({
      email,
    });

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

    await expect(
      refreshAccessToken({
        refreshToken: accessToken,
      }),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: "UNAUTHORIZED",
    });
  });

  it("should reject a revoked refresh token", async () => {
    const email = `refresh-test-${Date.now()}@example.com`;

    const user = await createUser({
      email,
    });

    const { refreshToken, record } =
      await createStoredRefreshToken(user.id, user);

    await prisma.refreshToken.update({
      where: {
        id: record.id,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    await expect(
      refreshAccessToken({
        refreshToken,
      }),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: "UNAUTHORIZED",
    });
  });

  it("should reject an expired refresh token", async () => {
    const email = `refresh-test-${Date.now()}@example.com`;

    const user = await createUser({
      email,
    });

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
        expiresAt: new Date(Date.now() - 60 * 1000),
      },
    });

    await expect(
      refreshAccessToken({
        refreshToken,
      }),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: "UNAUTHORIZED",
    });
  });

  it("should reject refresh for an inactive account", async () => {
    const email = `refresh-test-${Date.now()}@example.com`;

    const user = await createUser({
      email,
      status: "INACTIVE",
      emailVerifiedAt: new Date(),
    });

    const { refreshToken } = await createStoredRefreshToken(
      user.id,
      user,
    );

    await expect(
      refreshAccessToken({
        refreshToken,
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "FORBIDDEN",
    });
  });
});