import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../config/prisma";
import { verifyEmail } from "../auth/services/verify-email.service";
import { hashOtp } from "../auth/utils/otpHash";
import { hashPassword } from "../auth/utils/password";

describe("Verify Email Service", () => {
  const password = "StrongPassword123!";
  const otp = "123456";

  beforeEach(async () => {
    await prisma.emailVerificationOtp.deleteMany({
      where: {
        user: {
          email: {
            startsWith: "verify-test-",
          },
        },
      },
    });

    await prisma.user.deleteMany({
      where: {
        email: {
          startsWith: "verify-test-",
        },
      },
    });
  });

  const createTestUser = async (email: string) => {
    const passwordHash = await hashPassword(password);

    return prisma.user.create({
      data: {
        name: "Verify Test User",
        email,
        passwordHash,
        status: "INACTIVE",
        emailVerifiedAt: null,
      },
    });
  };

  const createOtp = async (userId: string, value = otp) => {
    const otpHash = await hashOtp(value);

    return prisma.emailVerificationOtp.create({
      data: {
        userId,
        otpHash,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });
  };

  it("should verify email with a correct OTP", async () => {
    const email = `verify-test-${Date.now()}@example.com`;

    const user = await createTestUser(email);
    const otpRecord = await createOtp(user.id);

    const result = await verifyEmail({
      email,
      otp,
    });

    expect(result.id).toBe(user.id);
    expect(result.email).toBe(email);
    expect(result.status).toBe("ACTIVE");
    expect(result.emailVerifiedAt).not.toBeNull();

    const updatedUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        status: true,
        emailVerifiedAt: true,
      },
    });

    expect(updatedUser?.status).toBe("ACTIVE");
    expect(updatedUser?.emailVerifiedAt).not.toBeNull();

    const updatedOtp = await prisma.emailVerificationOtp.findUnique({
      where: { id: otpRecord.id },
      select: {
        verifiedAt: true,
      },
    });

    expect(updatedOtp?.verifiedAt).not.toBeNull();
  });

  it("should reject an incorrect OTP", async () => {
    const email = `verify-test-${Date.now()}@example.com`;

    const user = await createTestUser(email);
    const otpRecord = await createOtp(user.id);

    await expect(
      verifyEmail({
        email,
        otp: "654321",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "BAD_REQUEST",
    });

    const unchangedOtp = await prisma.emailVerificationOtp.findUnique({
      where: { id: otpRecord.id },
      select: {
        verifiedAt: true,
      },
    });

    expect(unchangedOtp?.verifiedAt).toBeNull();
  });

  it("should reject an expired OTP", async () => {
    const email = `verify-test-${Date.now()}@example.com`;

    const user = await createTestUser(email);

    const otpHash = await hashOtp(otp);

    await prisma.emailVerificationOtp.create({
      data: {
        userId: user.id,
        otpHash,
        expiresAt: new Date(Date.now() - 60 * 1000),
      },
    });

    await expect(
      verifyEmail({
        email,
        otp,
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "BAD_REQUEST",
    });
  });

  it("should reject verification when OTP does not exist", async () => {
    const email = `verify-test-${Date.now()}@example.com`;

    await createTestUser(email);

    await expect(
      verifyEmail({
        email,
        otp,
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "BAD_REQUEST",
    });
  });

  it("should reject an already verified email", async () => {
    const email = `verify-test-${Date.now()}@example.com`;

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

    await expect(
      verifyEmail({
        email,
        otp,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "CONFLICT",
    });
  });

  it("should reject a non-existent user", async () => {
    const email = `verify-test-${Date.now()}@example.com`;

    await expect(
      verifyEmail({
        email,
        otp,
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "NOT_FOUND",
    });
  });
});