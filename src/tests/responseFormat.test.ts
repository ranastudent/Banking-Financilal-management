import request from "supertest";
import { describe, it, expect } from "vitest";

import app from "../app";

describe("Standard Response Format", () => {
  it("should return the standard format for a successful response", async () => {
    const response = await request(app)
      .get("/health")
      .expect((res) => {
        // /health may return 200 or 503 depending on
        // database/Redis availability during the test.
        expect([200, 503]).toContain(res.status);
      });

    expect(response.body).toHaveProperty("requestId");
    expect(response.body.requestId).toEqual(expect.any(String));

    if (response.status === 200) {
      expect(response.body).toHaveProperty("status", "ok");
    }
  });

  it("should return the standard format for a 404 error", async () => {
    const response = await request(app)
      .get("/this-route-does-not-exist")
      .expect(404);

    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Resource not found",
      },
    });

    expect(response.body.requestId).toEqual(expect.any(String));
  });
});