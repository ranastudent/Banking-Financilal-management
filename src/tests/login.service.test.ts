import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "../config/prisma";
import { loginUser } from "../auth/services/login.service";
import { hashPassword } from "../auth/utils/password";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

describe("Login Service", () => {
  const password = "StrongPassword123!";

  beforeEach(async () => {
    await prisma.emailVerificationOtp.deleteMany({
      where: {
        user: {
          email: {
            startsWith: "login-test-",
          },
        },
      },
    });

    await prisma.user.deleteMany({
      where: {
        email: {
          startsWith: "login-test-",
        },
      },
    });
  });

  const createUser = async ({
    email,
    status = "ACTIVE",
    emailVerifiedAt = new Date(),
    userPassword = password,
  }: {
    email: string;
    status?: "ACTIVE" | "INACTIVE";
    emailVerifiedAt?: Date | null;
    userPassword?: string;
  }) => {
    const passwordHash = await hashPassword(userPassword);

    return prisma.user.create({
      data: {
        name: "Login Test User",
        email,
        passwordHash,
        status,
        emailVerifiedAt,
      },
    });
  };

  it("should login successfully with valid credentials", async () => {
    const email = `login-test-${Date.now()}@example.com`;

    const user = await createUser({
      email,
    });

    const result = await loginUser({
      email,
      password,
    });

    expect(result.user.id).toBe(user.id);
    expect(result.user.email).toBe(email);
    expect(result.user.status).toBe("ACTIVE");

    expect(result.accessToken).toBeTypeOf("string");
    expect(result.refreshToken).toBeTypeOf("string");

    const accessPayload = jwt.verify(
      result.accessToken,
      env.jwtAccessSecret,
    ) as jwt.JwtPayload;

    expect(accessPayload.sub).toBe(user.id);

    const refreshPayload = jwt.verify(
      result.refreshToken,
      env.jwtRefreshSecret,
    ) as jwt.JwtPayload;

    expect(refreshPayload.sub).toBe(user.id);
    expect(refreshPayload.tokenType).toBe("refresh");
  });

  it("should reject an unknown email", async () => {
    const email = `login-test-${Date.now()}@example.com`;

    await expect(
      loginUser({
        email,
        password,
      }),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: "UNAUTHORIZED",
      message: "Invalid email or password",
    });
  });

  it("should reject an incorrect password", async () => {
    const email = `login-test-${Date.now()}@example.com`;

    await createUser({
      email,
    });

    await expect(
      loginUser({
        email,
        password: "WrongPassword123!",
      }),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: "UNAUTHORIZED",
      message: "Invalid email or password",
    });
  });

  it("should reject an unverified email", async () => {
    const email = `login-test-${Date.now()}@example.com`;

    await createUser({
      email,
      status: "INACTIVE",
      emailVerifiedAt: null,
    });

    await expect(
      loginUser({
        email,
        password,
      }),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: "UNAUTHORIZED",
      message: "Please verify your email before logging in",
    });
  });

  it("should reject an inactive account", async () => {
    const email = `login-test-${Date.now()}@example.com`;

    await createUser({
      email,
      status: "INACTIVE",
      emailVerifiedAt: new Date(),
    });

    await expect(
      loginUser({
        email,
        password,
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "FORBIDDEN",
      message: "Your account is not active",
    });
  });

  it("should normalize the login email", async () => {
    const email = `login-test-${Date.now()}@example.com`;

    await createUser({
      email,
    });

    const result = await loginUser({
      email: `  ${email.toUpperCase()}  `,
      password,
    });

    expect(result.user.email).toBe(email);
  });
});