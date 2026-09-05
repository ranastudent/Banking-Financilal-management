import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";

import app from "../app";
import { prisma } from "../config/prisma";
import { hashOtp } from "../auth/utils/otpHash";
import { hashPassword } from "../auth/utils/password";

describe("Verify Email Route", () => {
  const password = "StrongPassword123!";
  const otp = "123456";

  beforeEach(async () => {
    await prisma.emailVerificationOtp.deleteMany({
      where: {
        user: {
          email: {
            startsWith: "route-verify-",
          },
        },
      },
    });

    await prisma.user.deleteMany({
      where: {
        email: {
          startsWith: "route-verify-",
        },
      },
    });
  });

  const createTestUser = async (email: string) => {
    const passwordHash = await hashPassword(password);

    return prisma.user.create({
      data: {
        name: "Route Verify User",
        email,
        passwordHash,
        status: "INACTIVE",
        emailVerifiedAt: null,
      },
    });
  };

  const createOtp = async (
    userId: string,
    expiresAt = new Date(Date.now() + 10 * 60 * 1000),
  ) => {
    const otpHash = await hashOtp(otp);

    return prisma.emailVerificationOtp.create({
      data: {
        userId,
        otpHash,
        expiresAt,
      },
    });
  };

  it("should verify email successfully with a correct OTP", async () => {
    const email = `route-verify-${Date.now()}@example.com`;

    const user = await createTestUser(email);
    await createOtp(user.id);

    const response = await request(app)
      .post("/api/v1/auth/verify-email")
      .send({
        email,
        otp,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(response.body.data).toMatchObject({
      id: user.id,
      email,
      status: "ACTIVE",
    });

    expect(response.body.data.emailVerifiedAt).not.toBeNull();
    expect(response.body.requestId).toBeDefined();
  });

  it("should reject an incorrect OTP", async () => {
    const email = `route-verify-${Date.now()}@example.com`;

    const user = await createTestUser(email);
    await createOtp(user.id);

    const response = await request(app)
      .post("/api/v1/auth/verify-email")
      .send({
        email,
        otp: "654321",
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("BAD_REQUEST");
  });

  it("should reject an invalid OTP format", async () => {
    const email = `route-verify-${Date.now()}@example.com`;

    const user = await createTestUser(email);
    await createOtp(user.id);

    const response = await request(app)
      .post("/api/v1/auth/verify-email")
      .send({
        email,
        otp: "12345",
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("should reject an expired OTP", async () => {
    const email = `route-verify-${Date.now()}@example.com`;

    const user = await createTestUser(email);

    await createOtp(
      user.id,
      new Date(Date.now() - 60 * 1000),
    );

    const response = await request(app)
      .post("/api/v1/auth/verify-email")
      .send({
        email,
        otp,
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("BAD_REQUEST");
  });

  it("should reject a non-existent user", async () => {
    const email = `route-verify-${Date.now()}@example.com`;

    const response = await request(app)
      .post("/api/v1/auth/verify-email")
      .send({
        email,
        otp,
      });

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("should reject an already verified email", async () => {
    const email = `route-verify-${Date.now()}@example.com`;
    const passwordHash = await hashPassword(password);

    await prisma.user.create({
      data: {
        name: "Already Verified User",
        email,
        passwordHash,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });

    const response = await request(app)
      .post("/api/v1/auth/verify-email")
      .send({
        email,
        otp,
      });

    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("CONFLICT");
  });
});