import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";

import app from "../app";
import { prisma } from "../config/prisma";
import { hashPassword } from "../auth/utils/password";

describe("Login Route", () => {
  const password = "StrongPassword123!";

  beforeEach(async () => {
    await prisma.emailVerificationOtp.deleteMany({
      where: {
        user: {
          email: {
            startsWith: "login-route-",
          },
        },
      },
    });

    await prisma.user.deleteMany({
      where: {
        email: {
          startsWith: "login-route-",
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
        name: "Login Route User",
        email,
        passwordHash,
        status,
        emailVerifiedAt,
      },
    });
  };

  it("should login successfully with valid credentials", async () => {
    const email = `login-route-${Date.now()}@example.com`;

    const user = await createUser({
      email,
    });

    const response = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email,
        password,
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
    expect(response.body.requestId).toBeDefined();
  });

  it("should reject invalid login data", async () => {
    const response = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: "not-an-email",
        password: "",
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("should reject an unknown email", async () => {
    const email = `login-route-${Date.now()}@example.com`;

    const response = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email,
        password,
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
    expect(response.body.error.message).toBe(
      "Invalid email or password",
    );
  });

  it("should reject an incorrect password", async () => {
    const email = `login-route-${Date.now()}@example.com`;

    await createUser({
      email,
    });

    const response = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email,
        password: "WrongPassword123!",
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
    expect(response.body.error.message).toBe(
      "Invalid email or password",
    );
  });

  it("should reject an unverified email", async () => {
    const email = `login-route-${Date.now()}@example.com`;

    await createUser({
      email,
      status: "INACTIVE",
      emailVerifiedAt: null,
    });

    const response = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email,
        password,
      });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should reject an inactive account", async () => {
    const email = `login-route-${Date.now()}@example.com`;

    await createUser({
      email,
      status: "INACTIVE",
      emailVerifiedAt: new Date(),
    });

    const response = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email,
        password,
      });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });
});