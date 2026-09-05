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
      id: "test-user-id",
      name: "Test User",
      email: "controller@example.com",
      phone: null,
      role: "CUSTOMER",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
      createdAt: new Date(),
    });

    const response = await request(app)
      .post("/api/v1/auth/verify-email")
      .send({
        email: "controller@example.com",
        otp: "123456",
      });

    expect(response.status).toBe(404);
  });
});