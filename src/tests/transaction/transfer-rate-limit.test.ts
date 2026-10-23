import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import {
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import transferRoutes from "../../transaction/routes/transfer.routes";
import { env } from "../../config/env";
import { ensureRedisConnected } from "../../config/redis";
import { requestIdMiddleware } from "../../middleware/requestId";
import { errorHandler } from "../../middleware/errorHandler";

describe("Phase 21.4 — Transfer-Specific Rate Limiting", () => {
  const testApp = express();

  const testUser = {
    id: randomUUID(),
    email: `transfer-rate-limit-${randomUUID()}@example.com`,
    role: "CUSTOMER",
    status: "ACTIVE",
  };

  const accessToken = jwt.sign(
    {
      sub: testUser.id,
      email: testUser.email,
      role: testUser.role,
      status: testUser.status,
      tokenType: "access",
    },
    env.jwtAccessSecret,
    { expiresIn: "15m" },
  );

  // A unique IPv6 address prevents previous test runs from
  // normally sharing the same transfer rate-limit counter.
  const randomIpSegment = randomUUID()
    .replace(/-/g, "")
    .slice(0, 4);

  const testIp = `2001:db8:${randomIpSegment}::1`;

  beforeAll(async () => {
    // Connect Redis without closing the application's
    // shared Redis client after the test.
    await ensureRedisConnected();

    testApp.set("trust proxy", 1);

    testApp.use(requestIdMiddleware);
    testApp.use(express.json());

    testApp.use("/api/v1/transfers", transferRoutes);

    testApp.use(errorHandler);
  });

  it("allows requests below the configured transfer limit", async () => {
    const maxRequests = env.rateLimit.transfer.max;

    for (let i = 0; i < maxRequests; i++) {
      const response = await request(testApp)
        .post("/api/v1/transfers")
        .set("Authorization", `Bearer ${accessToken}`)
        .set("X-Forwarded-For", testIp)
        .set("X-Test-Rate-Limit", "true")
        .set("X-Test-Rate-Limit-Key", `transfer-${testIp}`)
        .send({});

      // An empty body should fail validation, but it must
      // not be rejected by the rate limiter before the
      // configured limit has been exceeded.
      expect(response.status).not.toBe(429);
    }
  });

  it("rejects requests exceeding the configured transfer limit", async () => {
    const maxRequests = env.rateLimit.transfer.max;

    // Use a fresh IP for this test.
    const freshIp = `2001:db8:${randomUUID()
      .replace(/-/g, "")
      .slice(0, 4)}::1`;

    // Consume the configured allowance.
    for (let i = 0; i < maxRequests; i++) {
      const response = await request(testApp)
        .post("/api/v1/transfers")
        .set("Authorization", `Bearer ${accessToken}`)
        .set("X-Forwarded-For", freshIp)
        .set("X-Test-Rate-Limit", "true")
        .set("X-Test-Rate-Limit-Key", `transfer-${freshIp}`)
        .send({});

      expect(response.status).not.toBe(429);
    }

    // The next request should exceed the limit.
    const response = await request(testApp)
      .post("/api/v1/transfers")
      .set("Authorization", `Bearer ${accessToken}`)
      .set("X-Forwarded-For", freshIp)
      .set("X-Test-Rate-Limit", "true")
      .set("X-Test-Rate-Limit-Key", `transfer-${freshIp}`)
      .send({});

    expect(response.status).toBe(429);

    expect(response.body.success).toBe(false);

    expect(response.body.error.code).toBe(
      "TRANSFER_RATE_LIMIT_EXCEEDED",
    );

    expect(response.body.error.message).toBe(
      "Too many transfer requests. Please try again later.",
    );

    expect(response.body.requestId).toBeDefined();
  });
});