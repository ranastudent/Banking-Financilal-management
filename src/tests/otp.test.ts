import { describe, expect, it } from "vitest";

import { generateOtp } from "../auth/utils/otp";

describe("OTP Generator", () => {
  it("should generate a 6-digit numeric OTP", () => {
    const otp = generateOtp();

    expect(otp).toMatch(/^\d{6}$/);
  });

  it("should generate an OTP within the valid range", () => {
    const otp = generateOtp();
    const numericOtp = Number(otp);

    expect(numericOtp).toBeGreaterThanOrEqual(100000);
    expect(numericOtp).toBeLessThanOrEqual(999999);
  });
});