import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import request from "supertest";

import app from "../app";
import { prisma } from "../config/prisma";
import { hashPassword } from "../auth/utils/password";
import { generateOtp } from "../auth/utils/otp";
import { hashOtp } from "../auth/utils/otpHash";
import * as emailService from "../auth/services/email.service";

describe("Authentication Integration", () => {
  let email: string;

  const password = "SecurePassword123!";

  beforeEach(async () => {
    email = `auth-flow-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}@example.com`;

    await prisma.refreshToken.deleteMany();
    await prisma.emailVerificationOtp.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    vi.restoreAllMocks();

    await prisma.refreshToken.deleteMany();
    await prisma.emailVerificationOtp.deleteMany();
    await prisma.user.deleteMany();
  });

  // ============================================================
  // 1. COMPLETE AUTHENTICATION LIFECYCLE
  // ============================================================

  it("should complete the full registration -> verification -> login -> refresh -> logout flow", async () => {
    let registrationOtp = "";

    const sendRegistrationOtpEmailSpy = vi
      .spyOn(emailService, "sendRegistrationOtpEmail")
      .mockImplementation(async (_email, otp) => {
        registrationOtp = otp;
      });

    // ----------------------------------------------------------
    // STEP 1: Register
    // ----------------------------------------------------------

    const registerResponse = await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Authentication Flow User",
        email,
        password,
      });

    expect(registerResponse.status).toBe(201);
    expect(registerResponse.body.success).toBe(true);

    // ----------------------------------------------------------
    // STEP 2: Verify email service was called
    // ----------------------------------------------------------

    expect(sendRegistrationOtpEmailSpy).toHaveBeenCalledTimes(1);

    expect(registrationOtp).toMatch(/^\d{6}$/);

    // ----------------------------------------------------------
    // STEP 3: Check database after registration
    // ----------------------------------------------------------

    const registeredUser = await prisma.user.findUnique({
      where: {
        email,
      },
    });

    expect(registeredUser).not.toBeNull();

    expect(registeredUser?.email).toBe(email);
    expect(registeredUser?.status).toBe("INACTIVE");
    expect(registeredUser?.emailVerifiedAt).toBeNull();

    // Password must be hashed.
    expect(registeredUser?.passwordHash).toBeDefined();
    expect(registeredUser?.passwordHash).not.toBe(password);

    // ----------------------------------------------------------
    // STEP 4: Check OTP record
    // ----------------------------------------------------------

    const otpRecord = await prisma.emailVerificationOtp.findFirst({
      where: {
        userId: registeredUser!.id,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    expect(otpRecord).not.toBeNull();

    expect(otpRecord?.otpHash).toBeDefined();
    expect(otpRecord?.otpHash).not.toBe(registrationOtp);
    expect(otpRecord?.verifiedAt).toBeNull();

    // ----------------------------------------------------------
    // STEP 5: Verify email
    // ----------------------------------------------------------

    const verifyResponse = await request(app)
      .post("/api/v1/auth/verify-email")
      .send({
        email,
        otp: registrationOtp,
      });

    expect(verifyResponse.status).toBe(200);
    expect(verifyResponse.body.success).toBe(true);

    // ----------------------------------------------------------
    // STEP 6: Check database after verification
    // ----------------------------------------------------------

    const verifiedUser = await prisma.user.findUnique({
      where: {
        email,
      },
    });

    expect(verifiedUser).not.toBeNull();

    expect(verifiedUser?.status).toBe("ACTIVE");
    expect(verifiedUser?.emailVerifiedAt).not.toBeNull();

    const verifiedOtpRecord =
      await prisma.emailVerificationOtp.findUnique({
        where: {
          id: otpRecord!.id,
        },
      });

    expect(verifiedOtpRecord).not.toBeNull();
    expect(verifiedOtpRecord?.verifiedAt).not.toBeNull();

    // ----------------------------------------------------------
    // STEP 7: Login
    // ----------------------------------------------------------

    const loginResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email,
        password,
      });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.success).toBe(true);

    const loginData = loginResponse.body.data;

    expect(loginData).toBeDefined();
    expect(loginData.accessToken).toBeDefined();
    expect(loginData.refreshToken).toBeDefined();
    expect(loginData.user).toBeDefined();

    expect(loginData.user.id).toBe(verifiedUser?.id);
    expect(loginData.user.email).toBe(email);
    expect(loginData.user.status).toBe("ACTIVE");

    // ----------------------------------------------------------
    // STEP 8: Sensitive data must not be exposed
    // ----------------------------------------------------------

    expect(loginData.user).not.toHaveProperty("password");
    expect(loginData.user).not.toHaveProperty("passwordHash");
    expect(loginData.user).not.toHaveProperty("refreshToken");

    const originalRefreshToken = loginData.refreshToken;

    expect(originalRefreshToken).toBeDefined();
    expect(originalRefreshToken).not.toBe("");

    // ----------------------------------------------------------
    // STEP 9: Verify refresh token is stored safely
    // ----------------------------------------------------------

    const storedRefreshToken = await prisma.refreshToken.findFirst({
      where: {
        userId: verifiedUser!.id,
        revokedAt: null,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    expect(storedRefreshToken).not.toBeNull();

    expect(storedRefreshToken?.tokenHash).toBeDefined();

    // Raw refresh token must not be stored.
    expect(storedRefreshToken?.tokenHash).not.toBe(
      originalRefreshToken,
    );

    expect(storedRefreshToken?.revokedAt).toBeNull();

    // ----------------------------------------------------------
    // STEP 10: Refresh token rotation
    // ----------------------------------------------------------

    const refreshResponse = await request(app)
      .post("/api/v1/auth/refresh")
      .send({
        refreshToken: originalRefreshToken,
      });

    expect(refreshResponse.status).toBe(200);
    expect(refreshResponse.body.success).toBe(true);

    const refreshData = refreshResponse.body.data;

    expect(refreshData).toBeDefined();
    expect(refreshData.accessToken).toBeDefined();
    expect(refreshData.refreshToken).toBeDefined();

    const rotatedRefreshToken = refreshData.refreshToken;

    expect(rotatedRefreshToken).not.toBe(originalRefreshToken);

    // ----------------------------------------------------------
    // STEP 11: Old refresh token must be rejected
    // ----------------------------------------------------------

    const oldRefreshReuseResponse = await request(app)
      .post("/api/v1/auth/refresh")
      .send({
        refreshToken: originalRefreshToken,
      });

    expect(oldRefreshReuseResponse.status).toBe(401);
    expect(oldRefreshReuseResponse.body.success).toBe(false);

    // ----------------------------------------------------------
    // STEP 12: Verify old refresh token was revoked
    // ----------------------------------------------------------

    const oldStoredToken = await prisma.refreshToken.findFirst({
        where: {
            userId: verifiedUser!.id,
            tokenHash: storedRefreshToken!.tokenHash,
            revokedAt: {
            not: null,
            },
        },
    });

    expect(oldStoredToken).not.toBeNull();
    expect(oldStoredToken?.revokedAt).not.toBeNull();

    // ----------------------------------------------------------
    // STEP 13: Logout
    // ----------------------------------------------------------

    const logoutResponse = await request(app)
      .post("/api/v1/auth/logout")
      .send({
        refreshToken: rotatedRefreshToken,
      });

    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.body.success).toBe(true);

    // ----------------------------------------------------------
    // STEP 14: Verify logout revoked current refresh token
    // ----------------------------------------------------------

    const loggedOutToken = await prisma.refreshToken.findFirst({
      where: {
        userId: verifiedUser!.id,
        revokedAt: {
          not: null,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    expect(loggedOutToken).not.toBeNull();
    expect(loggedOutToken?.revokedAt).not.toBeNull();

    // ----------------------------------------------------------
    // STEP 15: Refresh after logout must fail
    // ----------------------------------------------------------

    const postLogoutRefreshResponse = await request(app)
      .post("/api/v1/auth/refresh")
      .send({
        refreshToken: rotatedRefreshToken,
      });

    expect(postLogoutRefreshResponse.status).toBe(401);
    expect(postLogoutRefreshResponse.body.success).toBe(false);
  });

  // ============================================================
  // 2. UNVERIFIED USER CANNOT LOGIN
  // ============================================================

  it("should reject login before email verification", async () => {
    const passwordHash = await hashPassword(password);

    await prisma.user.create({
      data: {
        name: "Unverified Authentication User",
        email,
        passwordHash,
        role: "CUSTOMER",
        status: "INACTIVE",
        emailVerifiedAt: null,
      },
    });

    const loginResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email,
        password,
      });

    expect(loginResponse.status).toBe(401);
    expect(loginResponse.body.success).toBe(false);
    expect(loginResponse.body.error).toBeDefined();

    // No tokens should be issued.
    expect(loginResponse.body.data).toBeUndefined();
  });

  // ============================================================
  // 3. WRONG PASSWORD
  // ============================================================

  it("should reject an incorrect password", async () => {
    const passwordHash = await hashPassword(password);

    await prisma.user.create({
      data: {
        name: "Wrong Password User",
        email,
        passwordHash,
        role: "CUSTOMER",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });

    const loginResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email,
        password: "WrongPassword123!",
      });

    expect(loginResponse.status).toBe(401);
    expect(loginResponse.body.success).toBe(false);

    expect(loginResponse.body.data).toBeUndefined();
  });

  // ============================================================
  // 4. INVALID OTP
  // ============================================================

  it("should reject an invalid OTP", async () => {
    const passwordHash = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        name: "Invalid OTP User",
        email,
        passwordHash,
        role: "CUSTOMER",
        status: "INACTIVE",
        emailVerifiedAt: null,
      },
    });

    const validOtp = generateOtp();
    const invalidOtp = "000000";

    expect(invalidOtp).not.toBe(validOtp);

    await prisma.emailVerificationOtp.create({
      data: {
        userId: user.id,
        otpHash: await hashOtp(validOtp),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    const verifyResponse = await request(app)
      .post("/api/v1/auth/verify-email")
      .send({
        email,
        otp: invalidOtp,
      });

    expect(verifyResponse.status).toBe(400);
    expect(verifyResponse.body.success).toBe(false);

    // User must remain inactive.
    const unchangedUser = await prisma.user.findUnique({
      where: {
        id: user.id,
      },
    });

    expect(unchangedUser?.status).toBe("INACTIVE");
    expect(unchangedUser?.emailVerifiedAt).toBeNull();
  });
});