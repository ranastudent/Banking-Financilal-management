import request from "supertest";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("../../auth/services/otp.service", () => ({
  sendRegistrationOtp: vi.fn(),
}));

import app from "../../app";
import { prisma } from "../../config/prisma";

describe("Authentication - Register", () => {
  const createdUserEmails: string[] = [];

  const trackUser = (email: string) => {
    createdUserEmails.push(email);
  };

  afterEach(async () => {
    if (createdUserEmails.length === 0) {
      return;
    }

    const users = await prisma.user.findMany({
      where: {
        email: {
          in: createdUserEmails,
        },
      },
      select: {
        id: true,
      },
    });

    const userIds = users.map((user) => user.id);

    if (userIds.length > 0) {
      await prisma.refreshToken.deleteMany({
        where: {
          userId: {
            in: userIds,
          },
        },
      });

      await prisma.emailVerificationOtp.deleteMany({
        where: {
          userId: {
            in: userIds,
          },
        },
      });

      await prisma.auditLog.deleteMany({
        where: {
          userId: {
            in: userIds,
          },
        },
      });

      await prisma.user.deleteMany({
        where: {
          id: {
            in: userIds,
          },
        },
      });
    }

    createdUserEmails.length = 0;
  });

  it("should register a new user successfully", async () => {
    const testEmail =
      `register-${Date.now()}-${Math.random()}@example.com`;

    const testPhone =
      `017${Date.now().toString().slice(-8)}`;

    trackUser(testEmail);

    const response = await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Test User",
        email: testEmail,
        phone: testPhone,
        password: "StrongPassword123!",
      });

    expect(response.status).toBe(201);

    expect(response.body.success).toBe(true);

    expect(response.body.data).toMatchObject({
      name: "Test User",
      email: testEmail,
      phone: testPhone,
      role: "CUSTOMER",
      status: "INACTIVE",
      emailVerifiedAt: null,
    });

    expect(response.body.data).not.toHaveProperty(
      "password",
    );

    expect(response.body.data).not.toHaveProperty(
      "passwordHash",
    );
  });

  it("should store a hashed password instead of plaintext password", async () => {
    const email =
      `hash-${Date.now()}-${Math.random()}@example.com`;

    const password = "StrongPassword123!";

    trackUser(email);

    const response = await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Hash Test User",
        email,
        password,
      });

    expect(response.status).toBe(201);

    const user = await prisma.user.findUnique({
      where: {
        email,
      },
      select: {
        passwordHash: true,
      },
    });

    expect(user).not.toBeNull();

    expect(user?.passwordHash).not.toBe(password);

    expect(user?.passwordHash).toMatch(
      /^\$2[aby]\$/,
    );
  });

  it("should reject a duplicate email", async () => {
    const email =
      `duplicate-${Date.now()}-${Math.random()}@example.com`;

    trackUser(email);

    await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "First User",
        email,
        password: "StrongPassword123!",
      });

    const response = await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Second User",
        email,
        password: "AnotherPassword123!",
      });

    expect(response.status).toBe(409);

    expect(response.body.success).toBe(false);

    expect(response.body.error.code).toBe(
      "CONFLICT",
    );
  });

  it("should reject invalid registration data", async () => {
    const response = await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "A",
        email: "invalid-email",
        password: "123",
      });

    expect(response.status).toBe(400);

    expect(response.body.success).toBe(false);
  });

  it("should normalize the email before storing it", async () => {
    const email =
      `normalize-${Date.now()}-${Math.random()}@example.com`;

    trackUser(email);

    const response = await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Normalize User",
        email: `  ${email.toUpperCase()}  `,
        password: "StrongPassword123!",
      });

    expect(response.status).toBe(201);

    expect(response.body.data.email).toBe(email);

    const user = await prisma.user.findUnique({
      where: {
        email,
      },
      select: {
        email: true,
      },
    });

    expect(user?.email).toBe(email);
  });
});