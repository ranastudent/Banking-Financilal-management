import { describe, expect, it } from "vitest";

import { prisma } from "../config/prisma";
import { sendRegistrationOtp } from "../auth/services/otp.service";
import { hashPassword } from "../auth/utils/password";

describe("OTP Send Service", () => {
  it("should generate, hash, store, and send a registration OTP", async () => {
    const email = "reduanulislam92665@gmail.com";
    
    await prisma.emailVerificationOtp.deleteMany({
      where: {
        user: {
          email,
        },
      },
    });
    
    await prisma.user.deleteMany({
      where: {
        email,
      },
    });

    const passwordHash = await hashPassword("StrongPassword123!");

    const user = await prisma.user.create({
      data: {
        name: "OTP Test User",
        email,
        passwordHash,
        status: "INACTIVE",
        emailVerifiedAt: null,
      },
    });

    await expect(
      sendRegistrationOtp(user.id, user.email),
    ).resolves.not.toThrow();

    const otpRecord = await prisma.emailVerificationOtp.findFirst({
      where: {
        userId: user.id,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    expect(otpRecord).not.toBeNull();

    expect(otpRecord?.otpHash).toBeDefined();
    expect(otpRecord?.otpHash).not.toMatch(/^\d{6}$/);

    expect(otpRecord?.attempts).toBe(0);
    expect(otpRecord?.verifiedAt).toBeNull();

    expect(otpRecord?.expiresAt.getTime()).toBeGreaterThan(
      Date.now(),
    );
  }, 15000);
});