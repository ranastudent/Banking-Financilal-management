import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import app from "../../app";
import { env } from "../../config/env";
import { transactionHistoryRateLimiter } from "../../middleware/rateLimiter";
import { requestIdMiddleware } from "../../middleware/requestId";

describe("Rate Limiting", () => {
  it("should enforce the authentication rate limit", async () => {
    const testKey = `auth-${randomUUID()}`;
    const maxRequests = env.rateLimit.auth.max;

    for (let i = 0; i < maxRequests; i++) {
      const response = await request(app)
        .post("/test-validation/auth-rate-limit")
      .set("X-Test-Rate-Limit", "true")
      .set("X-Test-Rate-Limit-Key", testKey);

      expect(response.status).toBe(200);
    }

    const response = await request(app)
      .post("/test-validation/auth-rate-limit")
        .set("X-Test-Rate-Limit", "true")
        .set("X-Test-Rate-Limit-Key", testKey);

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

  it("should enforce the transaction-history rate limit and return HTTP 429", async () => {
    const testApp = express();
    testApp.set("trust proxy", 1);
    testApp.use(requestIdMiddleware);
    testApp.get(
      "/transaction-history",
      transactionHistoryRateLimiter,
      (_req, res) => {
        res.status(200).json({ success: true });
      },
    );

    const maxRequests = env.rateLimit.transactionHistory.max;
    const testIp = `2001:db8:${randomUUID().replace(/-/g, "").slice(0, 4)}::1`;

    for (let i = 0; i < maxRequests; i++) {
      const response = await request(testApp)
        .get("/transaction-history")
      .set("X-Forwarded-For", testIp)
      .set("X-Test-Rate-Limit", "true")
      .set("X-Test-Rate-Limit-Key", `history-${testIp}`);

      expect(response.status).toBe(200);
    }

    const response = await request(testApp)
      .get("/transaction-history")
      .set("X-Forwarded-For", testIp)
        .set("X-Test-Rate-Limit", "true")
        .set("X-Test-Rate-Limit-Key", `history-${testIp}`);

    expect(response.status).toBe(429);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code)
      .toBe("TRANSACTION_HISTORY_RATE_LIMIT_EXCEEDED");
    expect(response.body.error.message)
      .toBe("Too many transaction history requests. Please try again later.");
    expect(response.body.requestId).toBeDefined();
  });

  it("should enforce the OTP rate limit", async () => {
    const testKey = `otp-${randomUUID()}`;
    const maxRequests = env.rateLimit.otp.max;

    for (let i = 0; i < maxRequests; i++) {
      const response = await request(app)
        .post("/test-validation/otp-rate-limit")
      .set("X-Test-Rate-Limit", "true")
      .set("X-Test-Rate-Limit-Key", testKey);

      expect(response.status).toBe(200);
    }

    const response = await request(app)
      .post("/test-validation/otp-rate-limit")
        .set("X-Test-Rate-Limit", "true")
        .set("X-Test-Rate-Limit-Key", testKey);

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