import {
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
} from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import {
  generateAccessToken,
  generateRefreshToken,
} from "../../auth/utils/jwt";
import type { AuthUser } from "../../types/auth";

describe("14.3.1 Transfer Authentication", () => {
  const user: AuthUser = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    email: "transfer-auth-test@example.com",
    role: "CUSTOMER",
    status: "ACTIVE",
  };

  const transferPayload = {
    senderAccount: "ACC-1001",
    receiverAccount: "ACC-2002",
    amount: "5000.00",
    currency: "BDT",
  };

  const createAccessToken = (): string =>
    generateAccessToken(user);

  const createRefreshToken = (): string =>
    generateRefreshToken(user);

  const createExpiredAccessToken = (): string =>
    jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        tokenType: "access",
      },
      env.jwtAccessSecret,
      {
        expiresIn: -1,
      },
    );

  beforeAll(async () => {
    /*
     * Authentication tests should stop at the authentication layer.
     * No transfer transaction should be created by the rejected cases.
     */
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("should reject a transfer request without a JWT", async () => {
    const response = await request(app)
      .post("/api/v1/transfers")
      .set("Idempotency-Key", crypto.randomUUID())
      .send(transferPayload);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.requestId).toEqual(
      expect.any(String),
    );
  });

  it("should reject a transfer request with an invalid JWT", async () => {
    const response = await request(app)
      .post("/api/v1/transfers")
      .set(
        "Authorization",
        "Bearer invalid.jwt.token",
      )
      .set("Idempotency-Key", crypto.randomUUID())
      .send(transferPayload);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.requestId).toEqual(
      expect.any(String),
    );
  });

  it("should reject a transfer request with an expired JWT", async () => {
    const expiredToken = createExpiredAccessToken();

    const response = await request(app)
      .post("/api/v1/transfers")
      .set(
        "Authorization",
        `Bearer ${expiredToken}`,
      )
      .set("Idempotency-Key", crypto.randomUUID())
      .send(transferPayload);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.requestId).toEqual(
      expect.any(String),
    );
  });

  it("should reject a refresh token used as an access token", async () => {
    const refreshToken = createRefreshToken();

    const response = await request(app)
      .post("/api/v1/transfers")
      .set(
        "Authorization",
        `Bearer ${refreshToken}`,
      )
      .set("Idempotency-Key", crypto.randomUUID())
      .send(transferPayload);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.requestId).toEqual(
      expect.any(String),
    );
  });

  it("should accept a valid access token at the authentication layer", async () => {
    const accessToken = createAccessToken();

    const response = await request(app)
      .post("/api/v1/transfers")
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      )
      .set("Idempotency-Key", crypto.randomUUID())
      .send(transferPayload);

    /*
     * Authentication has succeeded if the request is no longer
     * rejected with 401 by the authentication middleware.
     *
     * The request may fail later because the test account data
     * is not part of this authentication test.
     */
    expect(response.status).not.toBe(401);
  });
});