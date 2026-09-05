import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../auth/services/otp.service", () => ({
  sendRegistrationOtp: vi.fn(),
}));

import app from "../app";
import { prisma } from "../config/prisma";
import { sendRegistrationOtp } from "../auth/services/otp.service";

describe("Authentication - Registration OTP Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create an inactive user and send a registration OTP", async () => {
    const email = `otp-register-${Date.now()}@example.com`;

    const response = await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "OTP Registration User",
        email,
        password: "StrongPassword123!",
      });

    expect(response.status).toBe(201);

    expect(response.body.success).toBe(true);

    expect(response.body.data).toMatchObject({
      email,
      status: "INACTIVE",
      emailVerifiedAt: null,
    });

    expect(sendRegistrationOtp).toHaveBeenCalledTimes(1);

    expect(sendRegistrationOtp).toHaveBeenCalledWith(
      response.body.data.id,
      email,
    );

    const user = await prisma.user.findUnique({
      where: {
        email,
      },
      select: {
        status: true,
        emailVerifiedAt: true,
      },
    });

    expect(user).not.toBeNull();
    expect(user?.status).toBe("INACTIVE");
    expect(user?.emailVerifiedAt).toBeNull();
  });
});