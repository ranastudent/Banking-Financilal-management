import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { hashPassword } from "../../auth/utils/password";
import { env } from "../../config/env";

describe("Login Integration", () => {
  const password = "StrongPassword123!";

  beforeEach(async () => {
    await prisma.emailVerificationOtp.deleteMany({
      where: {
        user: {
          email: {
            startsWith: "login-integration-",
          },
        },
      },
    });

    await prisma.user.deleteMany({
      where: {
        email: {
          startsWith: "login-integration-",
        },
      },
    });
  });

  const createUser = async (email: string) => {
    const passwordHash = await hashPassword(password);

    return prisma.user.create({
      data: {
        name: "Login Integration User",
        email,
        passwordHash,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });
  };

  it("should return valid access and refresh tokens", async () => {
    const email = `login-integration-${Date.now()}@example.com`;

    const user = await createUser(email);

    const response = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email,
        password,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const { data } = response.body;

    expect(data).toBeDefined();
    expect(data.user).toBeDefined();

    expect(data.user.id).toBe(user.id);
    expect(data.user.email).toBe(email);
    expect(data.user.role).toBe("CUSTOMER");
    expect(data.user.status).toBe("ACTIVE");

    expect(data.accessToken).toBeTypeOf("string");
    expect(data.refreshToken).toBeTypeOf("string");

    const accessPayload = jwt.verify(
      data.accessToken,
      env.jwtAccessSecret,
    ) as jwt.JwtPayload;

    expect(accessPayload.sub).toBe(user.id);
    expect(accessPayload.email).toBe(email);
    expect(accessPayload.role).toBe("CUSTOMER");
    expect(accessPayload.status).toBe("ACTIVE");
    expect(accessPayload.exp).toBeDefined();

    const refreshPayload = jwt.verify(
      data.refreshToken,
      env.jwtRefreshSecret,
    ) as jwt.JwtPayload;

    expect(refreshPayload.sub).toBe(user.id);
    expect(refreshPayload.tokenType).toBe("refresh");
    expect(refreshPayload.exp).toBeDefined();
  });

  it("should not expose password or passwordHash", async () => {
    const email = `login-integration-${Date.now()}@example.com`;

    await createUser(email);

    const response = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email,
        password,
      });

    expect(response.status).toBe(200);

    expect(response.body.data.user).not.toHaveProperty("password");
    expect(response.body.data.user).not.toHaveProperty("passwordHash");
  });

  it("should normalize email through the HTTP API", async () => {
    const email = `login-integration-${Date.now()}@example.com`;

    await createUser(email);

    const response = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: `  ${email.toUpperCase()}  `,
        password,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user.email).toBe(email);
  });

  it("should return a requestId in the login response", async () => {
    const email = `login-integration-${Date.now()}@example.com`;

    await createUser(email);

    const response = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email,
        password,
      });

    expect(response.status).toBe(200);
    expect(response.body.requestId).toBeDefined();
    expect(response.body.requestId).toBeTypeOf("string");
  });

  it("should use different secrets for access and refresh tokens", async () => {
    const email = `login-integration-${Date.now()}@example.com`;

    await createUser(email);

    const response = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email,
        password,
      });

    expect(response.status).toBe(200);

    const { accessToken, refreshToken } = response.body.data;

    expect(() => {
      jwt.verify(accessToken, env.jwtRefreshSecret);
    }).toThrow();

    expect(() => {
      jwt.verify(refreshToken, env.jwtAccessSecret);
    }).toThrow();
  });
});