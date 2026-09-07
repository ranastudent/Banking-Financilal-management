import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "../../config/prisma";
import { logoutUser } from "../../auth/services/logout.service";
import { generateRefreshToken } from "../../auth/utils/jwt";
import { hashRefreshToken } from "../../auth/utils/refreshTokenHash";
import { hashPassword } from "../../auth/utils/password";

describe("Logout Service", () => {
  const password = "StrongPassword123!";

  beforeEach(async () => {
    await prisma.refreshToken.deleteMany({
      where: {
        user: {
          email: {
            startsWith: "logout-test-",
          },
        },
      },
    });

    await prisma.user.deleteMany({
      where: {
        email: {
          startsWith: "logout-test-",
        },
      },
    });
  });

  const createUser = async (email: string) => {
    const passwordHash = await hashPassword(password);

    return prisma.user.create({
      data: {
        name: "Logout Test User",
        email,
        passwordHash,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });
  };

  const createRefreshToken = async (
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

  it("should revoke a valid refresh token", async () => {
    const email = `logout-test-${Date.now()}@example.com`;

    const user = await createUser(email);

    const { refreshToken, record } =
      await createRefreshToken(user);

    await expect(
      logoutUser({
        refreshToken,
      }),
    ).resolves.toBeUndefined();

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
    await expect(
      logoutUser({
        refreshToken: "invalid-refresh-token",
      }),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: "UNAUTHORIZED",
    });
  });

  it("should reject an already revoked refresh token", async () => {
    const email = `logout-test-${Date.now()}@example.com`;

    const user = await createUser(email);

    const { refreshToken, record } =
      await createRefreshToken(user);

    await prisma.refreshToken.update({
      where: {
        id: record.id,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    await expect(
      logoutUser({
        refreshToken,
      }),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: "UNAUTHORIZED",
    });
  });
});