import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "../../config/prisma";
import { hashPassword } from "../../auth/utils/password";
import { generateRefreshToken } from "../../auth/utils/jwt";
import { hashRefreshToken } from "../../auth/utils/refreshTokenHash";
import {  revokeAllRefreshTokensForUser, revokeRefreshToken } from "../../auth/services/token-revocation.service";

describe("Token Revocation Service", () => {
  const password = "StrongPassword123!";

  beforeEach(async () => {
    await prisma.refreshToken.deleteMany({
      where: {
        user: {
          email: {
            startsWith: "revoke-test-",
          },
        },
      },
    });

    await prisma.user.deleteMany({
      where: {
        email: {
          startsWith: "revoke-test-",
        },
      },
    });
  });

  const createUser = async (email: string) => {
    const passwordHash = await hashPassword(password);

    return prisma.user.create({
      data: {
        name: "Revocation Test User",
        email,
        passwordHash,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });
  };

  const createStoredToken = async (user: {
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

  it("should revoke an active refresh token", async () => {
    const email = `revoke-test-${Date.now()}@example.com`;

    const user = await createUser(email);

    const { refreshToken, record } =
      await createStoredToken(user);

    const result = await revokeRefreshToken(refreshToken);

    expect(result).toBe(true);

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

  it("should return false for an invalid refresh token", async () => {
    const result = await revokeRefreshToken(
      "invalid-refresh-token",
    );

    expect(result).toBe(false);
  });

  it("should return false when the refresh token is already revoked", async () => {
    const email = `revoke-test-${Date.now()}@example.com`;

    const user = await createUser(email);

    const { refreshToken, record } =
      await createStoredToken(user);

    await prisma.refreshToken.update({
      where: {
        id: record.id,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    const result = await revokeRefreshToken(refreshToken);

    expect(result).toBe(false);
  });

  it("should revoke all active refresh tokens for a user", async () => {
  const email = `revoke-test-${Date.now()}@example.com`;

  const user = await createUser(email);

  const firstToken = await createStoredToken(user);
  const secondToken = await createStoredToken(user);
  const thirdToken = await createStoredToken(user);

  const revokedCount =
    await revokeAllRefreshTokensForUser(user.id);

  expect(revokedCount).toBe(3);

  const tokens = await prisma.refreshToken.findMany({
    where: {
      userId: user.id,
    },
    select: {
      id: true,
      revokedAt: true,
    },
  });

  expect(tokens).toHaveLength(3);

  for (const token of tokens) {
    expect(token.revokedAt).not.toBeNull();
  }
});

it("should not modify already revoked refresh tokens", async () => {
  const email = `revoke-test-${Date.now()}@example.com`;

  const user = await createUser(email);

  const firstToken = await createStoredToken(user);
  const secondToken = await createStoredToken(user);

  await prisma.refreshToken.update({
    where: {
      id: firstToken.record.id,
    },
    data: {
      revokedAt: new Date("2025-01-01T00:00:00.000Z"),
    },
  });

  const revokedCount =
    await revokeAllRefreshTokensForUser(user.id);

  expect(revokedCount).toBe(1);

  const tokens = await prisma.refreshToken.findMany({
    where: {
      userId: user.id,
    },
    select: {
      id: true,
      revokedAt: true,
    },
  });

  const first = tokens.find(
    (token) => token.id === firstToken.record.id,
  );

  const second = tokens.find(
    (token) => token.id === secondToken.record.id,
  );

  expect(first?.revokedAt).toEqual(
    new Date("2025-01-01T00:00:00.000Z"),
  );

  expect(second?.revokedAt).not.toBeNull();
});
});