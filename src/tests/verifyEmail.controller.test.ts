import { describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../auth/services/verify-email.service", () => ({
  verifyEmail: vi.fn(),
}));

import app from "../app";
import { verifyEmail } from "../auth/services/verify-email.service";

describe("Verify Email Controller", () => {
  it("should verify email successfully", async () => {
    vi.mocked(verifyEmail).mockResolvedValue({
      id: "11111111-1111-1111-1111-111111111111",
      name: "Verify Controller User",
      email: "verify-controller@example.com",
      phone: null,
      role: "CUSTOMER",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
      createdAt: new Date(),
    });

    const response = await request(app)
      .post("/api/v1/auth/verify-email")
      .send({
        email: "verify-controller@example.com",
        otp: "123456",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(response.body.data).toMatchObject({
      id: "11111111-1111-1111-1111-111111111111",
      name: "Verify Controller User",
      email: "verify-controller@example.com",
      phone: null,
      role: "CUSTOMER",
      status: "ACTIVE",
    });

    expect(response.body.data.emailVerifiedAt).not.toBeNull();
    expect(response.body.requestId).toBeDefined();

    expect(verifyEmail).toHaveBeenCalledTimes(1);

    expect(verifyEmail).toHaveBeenCalledWith({
      email: "verify-controller@example.com",
      otp: "123456",
    });
  });
});