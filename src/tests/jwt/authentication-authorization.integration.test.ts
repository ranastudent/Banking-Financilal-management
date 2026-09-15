import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";

import app from "../../app";
import { prisma } from "../../config/prisma";
import * as emailService from "../../auth/services/email.service";

describe("Authentication + Authorization Full Integration", () => {
  const userPassword = "StrongPassword123!";

  const createdUserIds: string[] = [];

  const createTestEmail = (label: string) =>
    `${label}.${crypto.randomUUID()}@example.com`;

  afterEach(async () => {
    if (createdUserIds.length === 0) {
      return;
    }

    const userIds = [...createdUserIds];
    createdUserIds.length = 0;

    await prisma.refreshToken.deleteMany({
      where: {
        userId: {
          in: userIds,
        },
      },
    });

    await prisma.emailVerificationOtp.deleteMany({
      where: {
        userId: {
          in: userIds,
        },
      },
    });

    await prisma.user.deleteMany({
      where: {
        id: {
          in: userIds,
        },
      },
    });
  });

  it("should allow a real ADMIN user to login and access the ADMIN route", async () => {
    const sendOtpSpy = vi
      .spyOn(emailService, "sendRegistrationOtpEmail")
      .mockResolvedValue(undefined);

    try {
      const email = createTestEmail("admin.integration");

      const registerResponse = await request(app)
        .post("/api/v1/auth/register")
        .send({
          name: "Admin User",
          email,
          password: userPassword,
        });

      expect(registerResponse.status).toBe(201);

      const user = await prisma.user.update({
        where: {
          email,
        },
        data: {
          role: "ADMIN",
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
        },
      });

      createdUserIds.push(user.id);

      expect(user.role).toBe("ADMIN");

      const loginResponse = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email,
          password: userPassword,
        });

      expect(loginResponse.status).toBe(200);
      expect(loginResponse.body.data.accessToken).toEqual(
        expect.any(String),
      );

      const accessToken =
        loginResponse.body.data.accessToken;

      const protectedResponse = await request(app)
        .get("/api/v1/admin/test")
        .set("Authorization", `Bearer ${accessToken}`);

      expect(protectedResponse.status).toBe(200);
      expect(protectedResponse.body.success).toBe(true);
      expect(
        protectedResponse.body.data.user.role,
      ).toBe("ADMIN");
    } finally {
      sendOtpSpy.mockRestore();
    }
  });

  it("should allow a real CUSTOMER user to login but reject the ADMIN route", async () => {
    const sendOtpSpy = vi
      .spyOn(emailService, "sendRegistrationOtpEmail")
      .mockResolvedValue(undefined);

    try {
      const email = createTestEmail(
        "customer.integration",
      );

      const registerResponse = await request(app)
        .post("/api/v1/auth/register")
        .send({
          name: "Customer User",
          email,
          password: userPassword,
        });

      expect(registerResponse.status).toBe(201);

      const user = await prisma.user.update({
        where: {
          email,
        },
        data: {
          role: "CUSTOMER",
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
        },
      });

      createdUserIds.push(user.id);

      const loginResponse = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email,
          password: userPassword,
        });

      expect(loginResponse.status).toBe(200);

      const accessToken =
        loginResponse.body.data.accessToken;

      const protectedResponse = await request(app)
        .get("/api/v1/admin/test")
        .set("Authorization", `Bearer ${accessToken}`);

      expect(protectedResponse.status).toBe(403);
      expect(protectedResponse.body.success).toBe(false);
      expect(protectedResponse.body.error.code).toBe(
        "FORBIDDEN",
      );
    } finally {
      sendOtpSpy.mockRestore();
    }
  });

  it("should reject access when no authentication is provided", async () => {
    const response = await request(app).get(
      "/api/v1/admin/test",
    );

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("should preserve the authenticated user's identity through the full flow", async () => {
    const sendOtpSpy = vi
      .spyOn(emailService, "sendRegistrationOtpEmail")
      .mockResolvedValue(undefined);

    try {
      const email = createTestEmail("identity.admin");

      const registerResponse = await request(app)
        .post("/api/v1/auth/register")
        .send({
          name: "Identity Admin",
          email,
          password: userPassword,
        });

      expect(registerResponse.status).toBe(201);

      const user = await prisma.user.update({
        where: {
          email,
        },
        data: {
          role: "ADMIN",
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
        },
      });

      createdUserIds.push(user.id);

      const loginResponse = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email: user.email,
          password: userPassword,
        });

      expect(loginResponse.status).toBe(200);

      const accessToken =
        loginResponse.body.data.accessToken;

      const protectedResponse = await request(app)
        .get("/api/v1/admin/test")
        .set("Authorization", `Bearer ${accessToken}`);

      expect(protectedResponse.status).toBe(200);

      expect(
        protectedResponse.body.data.user,
      ).toEqual({
        id: user.id,
        email: user.email,
        role: "ADMIN",
        status: "ACTIVE",
      });
    } finally {
      sendOtpSpy.mockRestore();
    }
  });

  it("should not allow client-supplied identity to override JWT identity", async () => {
    const sendOtpSpy = vi
      .spyOn(emailService, "sendRegistrationOtpEmail")
      .mockResolvedValue(undefined);

    try {
      const email = createTestEmail(
        "identity-protection",
      );

      const registerResponse = await request(app)
        .post("/api/v1/auth/register")
        .send({
          name: "Identity Protection User",
          email,
          password: userPassword,
        });

      expect(registerResponse.status).toBe(201);

      const user = await prisma.user.update({
        where: {
          email,
        },
        data: {
          role: "ADMIN",
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
        },
      });

      createdUserIds.push(user.id);

      const loginResponse = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email: user.email,
          password: userPassword,
        });

      expect(loginResponse.status).toBe(200);

      const accessToken =
        loginResponse.body.data.accessToken;

      const attackerId = crypto.randomUUID();

      const protectedResponse = await request(app)
        .get("/api/v1/admin/test")
        .set("Authorization", `Bearer ${accessToken}`)
        .query({
          userId: attackerId,
          role: "CUSTOMER",
        });

      expect(protectedResponse.status).toBe(200);

      expect(
        protectedResponse.body.data.user,
      ).toEqual({
        id: user.id,
        email: user.email,
        role: "ADMIN",
        status: "ACTIVE",
      });

      expect(
        protectedResponse.body.data.user.id,
      ).not.toBe(attackerId);
    } finally {
      sendOtpSpy.mockRestore();
    }
  });

  it("should include requestId throughout the full authentication and authorization flow", async () => {
    const sendOtpSpy = vi
      .spyOn(emailService, "sendRegistrationOtpEmail")
      .mockResolvedValue(undefined);

    try {
      const email = createTestEmail(
        "requestid.admin",
      );

      const registerResponse = await request(app)
        .post("/api/v1/auth/register")
        .send({
          name: "Request ID Admin",
          email,
          password: userPassword,
        });

      expect(registerResponse.status).toBe(201);

      const user = await prisma.user.update({
        where: {
          email,
        },
        data: {
          role: "ADMIN",
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
        },
      });

      createdUserIds.push(user.id);

      const loginResponse = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email: user.email,
          password: userPassword,
        });

      expect(loginResponse.status).toBe(200);

      const accessToken =
        loginResponse.body.data.accessToken;

      const protectedResponse = await request(app)
        .get("/api/v1/admin/test")
        .set("Authorization", `Bearer ${accessToken}`);

      expect(protectedResponse.status).toBe(200);
      expect(protectedResponse.body).toHaveProperty(
        "requestId",
      );

      expect(
        protectedResponse.body.requestId,
      ).toEqual(expect.any(String));
    } finally {
      sendOtpSpy.mockRestore();
    }
  });
});