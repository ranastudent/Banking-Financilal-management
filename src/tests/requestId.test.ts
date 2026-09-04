import request from "supertest";
import { describe, it, expect } from "vitest";
import app from "../app";

describe("Request ID Middleware", () => {
  it("should return a requestId in the response", async () => {
    const response = await request(app)
      .get("/health");

    expect(response.body.requestId).toBeDefined();
    expect(typeof response.body.requestId).toBe("string");
    expect(response.body.requestId.length).toBeGreaterThan(0);
  });

  it("should return the same requestId sent by the client", async () => {
    const requestId = "test-request-id-123";

    const response = await request(app)
      .get("/health")
      .set("X-Request-ID", requestId);

    expect(response.body.requestId).toBe(requestId);
    expect(response.headers["x-request-id"]).toBe(requestId);
  });
});