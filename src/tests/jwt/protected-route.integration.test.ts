import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { hashPassword } from "../../auth/utils/password";

describe("Protected Route Integration", () => {
  const password = "SecurePassword123!";

  let email: string;
  let userId: string;

  beforeEach(async () => {
    email = `protected-route-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}@example.com`;

    await prisma.refreshToken.deleteMany();
    await prisma.emailVerificationOtp.deleteMany();
    await prisma.user.deleteMany();

    const passwordHash = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        name: "Protected Route User",
        email,
        passwordHash,
        role: "CUSTOMER",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });

    userId = user.id;
  });

  afterEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.emailVerificationOtp.deleteMany();
    await prisma.user.deleteMany();
  });

  // ============================================================
  // Helper: Real Login
  // ============================================================

  const loginAndGetAccessToken = async (): Promise<string> => {
    const loginResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email,
        password,
      });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.success).toBe(true);

    const accessToken =
      loginResponse.body.data.accessToken;

    expect(accessToken).toBeDefined();
    expect(typeof accessToken).toBe("string");

    return accessToken;
  };

  // ============================================================
  // 1. REAL LOGIN -> PROTECTED ROUTE
  // ============================================================

  it("should allow an authenticated user to access the protected route", async () => {
    const accessToken =
      await loginAndGetAccessToken();

    const response = await request(app)
      .get("/api/v1/auth/me")
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      );

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(response.body.data).toBeDefined();
    expect(response.body.data.id).toBe(userId);
    expect(response.body.data.email).toBe(email);
    expect(response.body.data.role).toBe("CUSTOMER");
    expect(response.body.data.status).toBe("ACTIVE");
  });

  // ============================================================
  // 2. NO TOKEN
  // ============================================================

  it("should reject access without an access token", async () => {
    const response = await request(app)
      .get("/api/v1/auth/me");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);

    expect(response.body.error).toBeDefined();
    expect(response.body.error.code).toBe(
      "UNAUTHORIZED",
    );

    expect(response.body.requestId).toBeDefined();
  });

  // ============================================================
  // 3. INVALID TOKEN
  // ============================================================

  it("should reject an invalid access token", async () => {
    const response = await request(app)
      .get("/api/v1/auth/me")
      .set(
        "Authorization",
        "Bearer invalid.jwt.token",
      );

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "UNAUTHORIZED",
    );
  });

  // ============================================================
  // 4. EXPIRED TOKEN
  // ============================================================

  it("should reject an expired access token", async () => {
    const expiredToken = jwt.sign(
      {
        sub: userId,
        email,
        role: "CUSTOMER",
        status: "ACTIVE",
        tokenType: "access",
      },
      env.jwtAccessSecret,
      {
        expiresIn: -1,
      },
    );

    const response = await request(app)
      .get("/api/v1/auth/me")
      .set(
        "Authorization",
        `Bearer ${expiredToken}`,
      );

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "UNAUTHORIZED",
    );
  });

  // ============================================================
  // 5. WRONG TOKEN TYPE
  // ============================================================

  it("should reject a refresh token used on a protected route", async () => {
    const refreshToken = jwt.sign(
      {
        sub: userId,
        email,
        role: "CUSTOMER",
        status: "ACTIVE",
        tokenType: "refresh",
      },
      env.jwtRefreshSecret,
      {
        expiresIn: "7d",
      },
    );

    const response = await request(app)
      .get("/api/v1/auth/me")
      .set(
        "Authorization",
        `Bearer ${refreshToken}`,
      );

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "UNAUTHORIZED",
    );
  });

  // ============================================================
  // 6. MALFORMED AUTHORIZATION HEADER
  // ============================================================

  it("should reject a malformed Authorization header", async () => {
    const response = await request(app)
      .get("/api/v1/auth/me")
      .set(
        "Authorization",
        "Basic invalid-token",
      );

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "UNAUTHORIZED",
    );
  });

  // ============================================================
  // 7. REAL USER IDENTITY
  // ============================================================

  it("should return the identity of the authenticated database user", async () => {
    const accessToken =
      await loginAndGetAccessToken();

    const response = await request(app)
      .get("/api/v1/auth/me")
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      );

    expect(response.status).toBe(200);

    expect(response.body.data.id).toBe(userId);
    expect(response.body.data.email).toBe(email);
  });

  // ============================================================
  // 8. SENSITIVE DATA PROTECTION
  // ============================================================

  it("should not expose sensitive authentication data", async () => {
    const accessToken =
      await loginAndGetAccessToken();

    const response = await request(app)
      .get("/api/v1/auth/me")
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      );

    expect(response.status).toBe(200);

    const user = response.body.data;

    expect(user).not.toHaveProperty("password");
    expect(user).not.toHaveProperty("passwordHash");
    expect(user).not.toHaveProperty("accessToken");
    expect(user).not.toHaveProperty("refreshToken");
  });

  // ============================================================
  // 9. REQUEST ID
  // ============================================================

  it("should include requestId in a protected-route response", async () => {
    const accessToken =
      await loginAndGetAccessToken();

    const response = await request(app)
      .get("/api/v1/auth/me")
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      );

    expect(response.status).toBe(200);

    expect(response.body.requestId).toBeDefined();
    expect(
      typeof response.body.requestId,
    ).toBe("string");
  });

  // ============================================================
  // 10. CLIENT CANNOT OVERRIDE AUTHENTICATED IDENTITY
  // ============================================================

  it("should use the JWT identity instead of client supplied identity", async () => {
    const accessToken =
      await loginAndGetAccessToken();

    const fakeUserId =
      "00000000-0000-0000-0000-000000000000";

    const response = await request(app)
      .get("/api/v1/auth/me")
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      )
      .send({
        userId: fakeUserId,
        email: "attacker@example.com",
        role: "ADMIN",
      });

    expect(response.status).toBe(200);

    expect(response.body.data.id).toBe(userId);
    expect(response.body.data.email).toBe(email);
    expect(response.body.data.role).toBe(
      "CUSTOMER",
    );

    expect(response.body.data.id).not.toBe(
      fakeUserId,
    );

    expect(response.body.data.email).not.toBe(
      "attacker@example.com",
    );

    expect(response.body.data.role).not.toBe(
      "ADMIN",
    );
  });
});