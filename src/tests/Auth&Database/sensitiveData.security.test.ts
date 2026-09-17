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

describe("Sensitive Data Protection", () => {
  let email: string;
  let createdUserId: string;

  const password = "SecurePassword123!";

  beforeEach(async () => {
    email = `sensitive-${Date.now()}-${Math.random()}@example.com`;

    const passwordHash = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        name: "Sensitive Data User",
        email,
        passwordHash,
        role: "CUSTOMER",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });

    createdUserId = user.id;
  });

  afterEach(async () => {
    if (!createdUserId) {
      return;
    }

    await prisma.refreshToken.deleteMany({
      where: {
        userId: createdUserId,
      },
    });

    await prisma.emailVerificationOtp.deleteMany({
      where: {
        userId: createdUserId,
      },
    });

    await prisma.auditLog.deleteMany({
      where: {
        userId: createdUserId,
      },
    });

    await prisma.user.delete({
      where: {
        id: createdUserId,
      },
    });

    createdUserId = "";
  });

  it("should not expose password, passwordHash, or refresh token in the login response", async () => {
    const response = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email,
        password,
      });

    expect(response.status).toBe(200);

    const bodyText = JSON.stringify(response.body);

    expect(bodyText).not.toContain(password);

    expect(response.body.data.user).not.toHaveProperty(
      "password",
    );

    expect(response.body.data.user).not.toHaveProperty(
      "passwordHash",
    );

    expect(response.body.data.refreshToken).toBeDefined();

    /*
     * The refresh token is intentionally returned by the
     * login endpoint because the client needs it.
     *
     * It must not appear inside the user object.
     */
    expect(response.body.data.user).not.toHaveProperty(
      "refreshToken",
    );
  });

  it("should not expose passwordHash through the stored user object returned by login", async () => {
    const response = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email,
        password,
      });

    expect(response.status).toBe(200);

    const user = response.body.data.user;

    expect(Object.keys(user)).not.toContain(
      "password",
    );

    expect(Object.keys(user)).not.toContain(
      "passwordHash",
    );
  });
});