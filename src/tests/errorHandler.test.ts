import request from "supertest";
import { describe, it, expect } from "vitest";
import app from "../app";

describe("Global Error Handler", () => {
  it("should handle unexpected errors with 500", async () => {
    const response = await request(app)
      .get("/test-error");

    expect(response.status).toBe(500);

    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Something went wrong",
      },
    });

    expect(response.body.requestId).toBeDefined();
    expect(typeof response.body.requestId).toBe("string");
  });

  it("should handle AppError with the correct status and error code", async () => {
    const response = await request(app)
      .get("/test-app-error");

    expect(response.status).toBe(404);

    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: "RESOURCE_NOT_FOUND",
        message: "Account not found",
      },
    });

    expect(response.body.requestId).toBeDefined();
    expect(typeof response.body.requestId).toBe("string");
  });
});