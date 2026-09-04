import request from "supertest";
import { describe, it, expect } from "vitest";
import app from "../app";

describe("Request Validation", () => {
  it("should reject an invalid request body", async () => {
    const response = await request(app)
      .post("/test-validation/body")
      .send({
        email: "invalid-email",
        amount: "-100",
        currency: "bdt",
        accountNumber: "123",
      })
      .expect(400);

    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
      },
    });

    expect(response.body.requestId).toEqual(expect.any(String));
  });
});