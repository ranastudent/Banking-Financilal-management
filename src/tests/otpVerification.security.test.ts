import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "../config/prisma";
import { verifyEmail } from "../auth/services/verify-email.service";
import { hashOtp } from "../auth/utils/otpHash";
import { hashPassword } from "../auth/utils/password";

describe("OTP Verification Security", () => {
  const password = "StrongPassword123!";

  beforeEach(async () => {
    await prisma.emailVerificationOtp.deleteMany({
      where: {
        user: {
          email: {
            startsWith: "security-otp-",
          },
        },
      },
    });

    await prisma.user.deleteMany({
      where: {
        email: {
          startsWith: "security-otp-",
        },
      },
    });
  });

  const createTestUser = async (email: string) => {
    const passwordHash = await hashPassword(password);

    return prisma.user.create({
      data: {
        name: "Security OTP User",
        email,
        passwordHash,
        status: "INACTIVE",
        emailVerifiedAt: null,
      },
    });
  };

  it("should not allow a verified OTP to be reused", async () => {
    const email = `security-otp-${Date.now()}@example.com`;
    const otp = "123456";

    const user = await createTestUser(email);
    const otpHash = await hashOtp(otp);

    const otpRecord = await prisma.emailVerificationOtp.create({
      data: {
        userId: user.id,
        otpHash,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    await verifyEmail({
      email,
      otp,
    });

    const updatedOtp = await prisma.emailVerificationOtp.findUnique({
      where: {
        id: otpRecord.id,
      },
      select: {
        verifiedAt: true,
      },
    });

    expect(updatedOtp?.verifiedAt).not.toBeNull();

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

  it("should verify using the latest unverified OTP", async () => {
    const email = `security-otp-${Date.now()}@example.com`;

    const user = await createTestUser(email);

    const oldOtp = "111111";
    const newOtp = "222222";

    const oldOtpHash = await hashOtp(oldOtp);
    const newOtpHash = await hashOtp(newOtp);

    const oldOtpRecord = await prisma.emailVerificationOtp.create({
      data: {
        userId: user.id,
        otpHash: oldOtpHash,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const newOtpRecord = await prisma.emailVerificationOtp.create({
      data: {
        userId: user.id,
        otpHash: newOtpHash,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    await expect(
      verifyEmail({
        email,
        otp: oldOtp,
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "BAD_REQUEST",
    });

    const result = await verifyEmail({
      email,
      otp: newOtp,
    });

    expect(result.status).toBe("ACTIVE");
    expect(result.emailVerifiedAt).not.toBeNull();

    const oldOtpAfter = await prisma.emailVerificationOtp.findUnique({
      where: {
        id: oldOtpRecord.id,
      },
      select: {
        verifiedAt: true,
      },
    });

    const newOtpAfter = await prisma.emailVerificationOtp.findUnique({
      where: {
        id: newOtpRecord.id,
      },
      select: {
        verifiedAt: true,
      },
    });

    expect(oldOtpAfter?.verifiedAt).toBeNull();
    expect(newOtpAfter?.verifiedAt).not.toBeNull();
  });
});