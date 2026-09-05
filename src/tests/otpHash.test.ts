import { describe, expect, it } from "vitest";

import { hashOtp, compareOtp } from "../auth/utils/otpHash";

describe("OTP Hashing", () => {
  it("should hash the OTP instead of storing plaintext", async () => {
    const otp = "483921";

    const otpHash = await hashOtp(otp);

    expect(otpHash).not.toBe(otp);
    expect(otpHash).toMatch(/^\$2[aby]\$/);
  });

  it("should verify the correct OTP", async () => {
    const otp = "483921";

    const otpHash = await hashOtp(otp);

    const result = await compareOtp(otp, otpHash);

    expect(result).toBe(true);
  });

  it("should reject an incorrect OTP", async () => {
    const otp = "483921";
    const wrongOtp = "123456";

    const otpHash = await hashOtp(otp);

    const result = await compareOtp(wrongOtp, otpHash);

    expect(result).toBe(false);
  });
});