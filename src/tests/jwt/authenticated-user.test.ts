import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import request from "supertest";

import app from "../../app";
import { prisma } from "../../config/prisma";
import { hashPassword } from "../../auth/utils/password";

describe("Authenticated User", () => {
  const password = "SecurePassword123!";

  let email: string;
  let userId: string;

  beforeEach(async () => {
    email = `authenticated-user-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}@example.com`;

    await prisma.refreshToken.deleteMany();
    await prisma.emailVerificationOtp.deleteMany();
    await prisma.user.deleteMany();

    const passwordHash = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        name: "Authenticated User",
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
  // 1. REAL LOGIN -> ACCESS TOKEN -> PROTECTED API
  // ============================================================

  it("should identify the authenticated user through the real login flow", async () => {
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

    const meResponse = await request(app)
      .get("/api/v1/auth/me")
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      );

    expect(meResponse.status).toBe(200);
    expect(meResponse.body.success).toBe(true);

    expect(meResponse.body.data).toBeDefined();

    expect(meResponse.body.data.id).toBe(userId);
    expect(meResponse.body.data.email).toBe(email);
    expect(meResponse.body.data.role).toBe("CUSTOMER");
    expect(meResponse.body.data.status).toBe("ACTIVE");
  });

  // ============================================================
  // 2. AUTHENTICATED USER ID
  // ============================================================

  it("should preserve the authenticated user's id", async () => {
    const loginResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email,
        password,
      });

    expect(loginResponse.status).toBe(200);

    const accessToken =
      loginResponse.body.data.accessToken;

    const meResponse = await request(app)
      .get("/api/v1/auth/me")
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      );

    expect(meResponse.status).toBe(200);
    expect(meResponse.body.data.id).toBe(userId);
  });

  // ============================================================
  // 3. AUTHENTICATED USER EMAIL
  // ============================================================

  it("should preserve the authenticated user's email", async () => {
    const loginResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email,
        password,
      });

    expect(loginResponse.status).toBe(200);

    const accessToken =
      loginResponse.body.data.accessToken;

    const meResponse = await request(app)
      .get("/api/v1/auth/me")
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      );

    expect(meResponse.status).toBe(200);
    expect(meResponse.body.data.email).toBe(email);
  });

  // ============================================================
  // 4. AUTHENTICATED USER ROLE
  // ============================================================

  it("should preserve the authenticated user's role", async () => {
    const loginResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email,
        password,
      });

    expect(loginResponse.status).toBe(200);

    const accessToken =
      loginResponse.body.data.accessToken;

    const meResponse = await request(app)
      .get("/api/v1/auth/me")
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      );

    expect(meResponse.status).toBe(200);
    expect(meResponse.body.data.role).toBe("CUSTOMER");
  });

  // ============================================================
  // 5. AUTHENTICATED USER STATUS
  // ============================================================

  it("should preserve the authenticated user's status", async () => {
    const loginResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email,
        password,
      });

    expect(loginResponse.status).toBe(200);

    const accessToken =
      loginResponse.body.data.accessToken;

    const meResponse = await request(app)
      .get("/api/v1/auth/me")
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      );

    expect(meResponse.status).toBe(200);
    expect(meResponse.body.data.status).toBe("ACTIVE");
  });

  // ============================================================
  // 6. NO SENSITIVE DATA
  // ============================================================

  it("should not expose sensitive authentication data", async () => {
    const loginResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email,
        password,
      });

    expect(loginResponse.status).toBe(200);

    const accessToken =
      loginResponse.body.data.accessToken;

    const meResponse = await request(app)
      .get("/api/v1/auth/me")
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      );

    expect(meResponse.status).toBe(200);

    const user = meResponse.body.data;

    expect(user).not.toHaveProperty("password");
    expect(user).not.toHaveProperty("passwordHash");
    expect(user).not.toHaveProperty("refreshToken");
    expect(user).not.toHaveProperty("accessToken");
  });

  // ============================================================
  // 7. REQUEST MUST BE AUTHENTICATED
  // ============================================================

  it("should reject the same protected endpoint without authentication", async () => {
    const meResponse = await request(app)
      .get("/api/v1/auth/me");

    expect(meResponse.status).toBe(401);
    expect(meResponse.body.success).toBe(false);
  });

  // ============================================================
  // 8. AUTHENTICATED USER CANNOT BE OVERRIDDEN BY REQUEST BODY
  // ============================================================

  it("should use the authenticated identity instead of client supplied identity", async () => {
    const loginResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email,
        password,
      });

    expect(loginResponse.status).toBe(200);

    const accessToken =
      loginResponse.body.data.accessToken;

    const fakeUserId =
      "00000000-0000-0000-0000-000000000000";

    const meResponse = await request(app)
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

    expect(meResponse.status).toBe(200);

    expect(meResponse.body.data.id).toBe(userId);
    expect(meResponse.body.data.email).toBe(email);
    expect(meResponse.body.data.role).toBe("CUSTOMER");

    expect(meResponse.body.data.id).not.toBe(
      fakeUserId,
    );

    expect(meResponse.body.data.email).not.toBe(
      "attacker@example.com",
    );

    expect(meResponse.body.data.role).not.toBe(
      "ADMIN",
    );
  });

  // ============================================================
  // 9. REQUEST ID
  // ============================================================

  it("should include a requestId for an authenticated request", async () => {
    const loginResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email,
        password,
      });

    expect(loginResponse.status).toBe(200);

    const accessToken =
      loginResponse.body.data.accessToken;

    const meResponse = await request(app)
      .get("/api/v1/auth/me")
      .set(
        "Authorization",
        `Bearer ${accessToken}`,
      );

    expect(meResponse.status).toBe(200);

    expect(meResponse.body.requestId).toBeDefined();
    expect(
      typeof meResponse.body.requestId,
    ).toBe("string");
  });
});