import request from "supertest";
import { describe, expect, it } from "vitest";
import app from "../app";
import { env } from "../config/env";

describe("Rate Limiting", () => {
  it("should enforce the authentication rate limit", async () => {
    const maxRequests = env.rateLimit.auth.max;

    for (let i = 0; i < maxRequests; i++) {
      const response = await request(app)
        .post("/test-validation/auth-rate-limit");

      expect(response.status).toBe(200);
    }

    const response = await request(app)
      .post("/test-validation/auth-rate-limit");

    expect(response.status).toBe(429);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code)
      .toBe("AUTH_RATE_LIMIT_EXCEEDED");

    expect(response.body.error.message)
      .toBe(
        "Too many authentication attempts. Please try again later.",
      );

    expect(response.body.requestId).toBeDefined();
  });

  it("should enforce the OTP rate limit", async () => {
    const maxRequests = env.rateLimit.otp.max;

    for (let i = 0; i < maxRequests; i++) {
      const response = await request(app)
        .post("/test-validation/otp-rate-limit");

      expect(response.status).toBe(200);
    }

    const response = await request(app)
      .post("/test-validation/otp-rate-limit");

    expect(response.status).toBe(429);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code)
      .toBe("OTP_RATE_LIMIT_EXCEEDED");

    expect(response.body.error.message)
      .toBe(
        "Too many OTP requests. Please try again later.",
      );

    expect(response.body.requestId).toBeDefined();
  });
});