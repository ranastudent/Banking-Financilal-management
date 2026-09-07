import {
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { prisma } from "../config/prisma";
import { hashPassword } from "../auth/utils/password";
import { loginUser } from "../auth/services/login.service";
import { refreshAccessToken } from "../auth/services/refresh-token.service";
import { logoutUser } from "../auth/services/logout.service";
import { hashRefreshToken } from "../auth/utils/refreshTokenHash";

describe("Authentication Security Integration", () => {
  const password = "StrongPassword123!";

  beforeEach(async () => {
    await prisma.refreshToken.deleteMany({
      where: {
        user: {
          email: {
            startsWith: "security-auth-",
          },
        },
      },
    });

    await prisma.emailVerificationOtp.deleteMany({
      where: {
        user: {
          email: {
            startsWith: "security-auth-",
          },
        },
      },
    });

    await prisma.user.deleteMany({
      where: {
        email: {
          startsWith: "security-auth-",
        },
      },
    });
  });

  const createUser = async (email: string) => {
    const passwordHash = await hashPassword(password);

    return prisma.user.create({
      data: {
        name: "Security Integration User",
        email,
        passwordHash,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });
  };

  it("should reject an old refresh token after rotation", async () => {
    const email = `security-auth-${Date.now()}@example.com`;

    await createUser(email);

    const loginResult = await loginUser({
      email,
      password,
    });

    const oldRefreshToken = loginResult.refreshToken;

    const refreshResult = await refreshAccessToken({
      refreshToken: oldRefreshToken,
    });

    expect(refreshResult.accessToken).toBeTypeOf("string");
    expect(refreshResult.refreshToken).toBeTypeOf("string");

    expect(refreshResult.refreshToken).not.toBe(
      oldRefreshToken,
    );

    await expect(
      refreshAccessToken({
        refreshToken: oldRefreshToken,
      }),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: "UNAUTHORIZED",
    });
  });

  it("should reject a refresh token after logout", async () => {
    const email = `security-auth-${Date.now()}@example.com`;

    await createUser(email);

    const loginResult = await loginUser({
      email,
      password,
    });

    const refreshToken = loginResult.refreshToken;

    await logoutUser({
      refreshToken,
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

  it("should not store a plaintext refresh token", async () => {
    const email = `security-auth-${Date.now()}@example.com`;

    const user = await createUser(email);

    const loginResult = await loginUser({
      email,
      password,
    });

    const tokenHash = hashRefreshToken(
      loginResult.refreshToken,
    );

    const storedToken = await prisma.refreshToken.findFirst({
      where: {
        userId: user.id,
        tokenHash,
      },
    });

    expect(storedToken).not.toBeNull();

    expect(storedToken?.tokenHash).not.toBe(
      loginResult.refreshToken,
    );
  });

    it("should allow only one successful rotation for the same refresh token", async () => {
    const email = `security-auth-${Date.now()}@example.com`;

    await createUser(email);

    const loginResult = await loginUser({
      email,
      password,
    });

    const refreshToken = loginResult.refreshToken;

    const results = await Promise.allSettled([
      refreshAccessToken({
        refreshToken,
      }),
      refreshAccessToken({
        refreshToken,
      }),
    ]);

    const successfulResults = results.filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof refreshAccessToken>>
      > => result.status === "fulfilled",
    );

    const failedResults = results.filter(
      (result) => result.status === "rejected",
    );

    expect(successfulResults.length).toBe(1);
    expect(failedResults.length).toBe(1);
  });
});