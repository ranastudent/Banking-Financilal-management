import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import app from "../../app";
import { prisma } from "../../config/prisma";
import * as emailService from "../../auth/services/email.service";

describe("Authentication + Authorization Full Integration", () => {
  const userPassword = "StrongPassword123!";

  beforeEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.emailVerificationOtp.deleteMany();
    await prisma.user.deleteMany();
  });

  it("should allow a real ADMIN user to login and access the ADMIN route", async () => {
    const sendOtpSpy = vi
      .spyOn(emailService, "sendRegistrationOtpEmail")
      .mockResolvedValue(undefined);

    const registerResponse = await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Admin User",
        email: "admin.integration@example.com",
        password: userPassword,
      });

    expect(registerResponse.status).toBe(201);

    const user = await prisma.user.update({
      where: {
        email: "admin.integration@example.com",
      },
      data: {
        role: "ADMIN",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });

    expect(user.role).toBe("ADMIN");

    const loginResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: "admin.integration@example.com",
        password: userPassword,
      });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.data.accessToken).toEqual(
      expect.any(String),
    );

    const accessToken = loginResponse.body.data.accessToken;

    const protectedResponse = await request(app)
      .get("/api/v1/admin/test")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(protectedResponse.status).toBe(200);
    expect(protectedResponse.body.success).toBe(true);
    expect(protectedResponse.body.data.user.role).toBe("ADMIN");

    sendOtpSpy.mockRestore();
  });

  it("should allow a real CUSTOMER user to login but reject the ADMIN route", async () => {
    const sendOtpSpy = vi
      .spyOn(emailService, "sendRegistrationOtpEmail")
      .mockResolvedValue(undefined);

    await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Customer User",
        email: "customer.integration@example.com",
        password: userPassword,
      });

    await prisma.user.update({
      where: {
        email: "customer.integration@example.com",
      },
      data: {
        role: "CUSTOMER",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });

    const loginResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: "customer.integration@example.com",
        password: userPassword,
      });

    expect(loginResponse.status).toBe(200);

    const accessToken = loginResponse.body.data.accessToken;

    const protectedResponse = await request(app)
      .get("/api/v1/admin/test")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(protectedResponse.status).toBe(403);
    expect(protectedResponse.body.success).toBe(false);
    expect(protectedResponse.body.error.code).toBe("FORBIDDEN");

    sendOtpSpy.mockRestore();
  });

  it("should reject access when no authentication is provided", async () => {
    const response = await request(app)
      .get("/api/v1/admin/test");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should preserve the authenticated user's identity through the full flow", async () => {
    const sendOtpSpy = vi
      .spyOn(emailService, "sendRegistrationOtpEmail")
      .mockResolvedValue(undefined);

    await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Identity Admin",
        email: "identity.admin@example.com",
        password: userPassword,
      });

    const user = await prisma.user.update({
      where: {
        email: "identity.admin@example.com",
      },
      data: {
        role: "ADMIN",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });

    const loginResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: user.email,
        password: userPassword,
      });

    expect(loginResponse.status).toBe(200);

    const accessToken = loginResponse.body.data.accessToken;

    const protectedResponse = await request(app)
      .get("/api/v1/admin/test")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(protectedResponse.status).toBe(200);

    expect(protectedResponse.body.data.user).toEqual({
      id: user.id,
      email: user.email,
      role: "ADMIN",
      status: "ACTIVE",
    });

    sendOtpSpy.mockRestore();
  });

  it("should not allow client-supplied identity to override JWT identity", async () => {
    const sendOtpSpy = vi
      .spyOn(emailService, "sendRegistrationOtpEmail")
      .mockResolvedValue(undefined);

    await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Real Admin",
        email: "real.admin@example.com",
        password: userPassword,
      });

    await prisma.user.update({
      where: {
        email: "real.admin@example.com",
      },
      data: {
        role: "ADMIN",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });

    const loginResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: "real.admin@example.com",
        password: userPassword,
      });

    expect(loginResponse.status).toBe(200);

    const accessToken = loginResponse.body.data.accessToken;

    const response = await request(app)
      .get("/api/v1/admin/test")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        userId: "attacker-user",
        role: "CUSTOMER",
        email: "attacker@example.com",
      });

    expect(response.status).toBe(200);

    expect(response.body.data.user.email).toBe(
      "real.admin@example.com",
    );

    expect(response.body.data.user.role).toBe("ADMIN");

    sendOtpSpy.mockRestore();
  });

  it("should include requestId throughout the full authentication and authorization flow", async () => {
    const sendOtpSpy = vi
      .spyOn(emailService, "sendRegistrationOtpEmail")
      .mockResolvedValue(undefined);

    await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Request ID Admin",
        email: "requestid.admin@example.com",
        password: userPassword,
      });

    await prisma.user.update({
      where: {
        email: "requestid.admin@example.com",
      },
      data: {
        role: "ADMIN",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });

    const loginResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: "requestid.admin@example.com",
        password: userPassword,
      });

    expect(loginResponse.status).toBe(200);

    const accessToken = loginResponse.body.data.accessToken;

    const protectedResponse = await request(app)
      .get("/api/v1/admin/test")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(protectedResponse.status).toBe(200);
    expect(protectedResponse.body.requestId).toEqual(
      expect.any(String),
    );

    sendOtpSpy.mockRestore();
  });
});