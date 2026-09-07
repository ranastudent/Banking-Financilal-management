import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../app";

describe("Authentication Rate Limit Integration", () => {
  it("should enforce the authentication rate limit on the login endpoint", async () => {
    const responses = [];

    for (let i = 0; i < 11; i++) {
      const response = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email: "ratelimit@example.com",
          password: "WrongPassword123!",
        });

      responses.push(response);
    }

    const statusCodes = responses.map((response) => response.status);

    expect(statusCodes.slice(0, 10).every((status) => status !== 429)).toBe(true);
    expect(statusCodes[10]).toBe(429);
  });

  it("should return a proper rate-limit error response", async () => {
    let lastResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: "ratelimit-error@example.com",
        password: "WrongPassword123!",
      });

    for (let i = 1; i < 11; i++) {
      lastResponse = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email: "ratelimit-error@example.com",
          password: "WrongPassword123!",
        });
    }

    expect(lastResponse.status).toBe(429);
    expect(lastResponse.body.success).toBe(false);
    expect(lastResponse.body.error).toBeDefined();
    expect(lastResponse.body.requestId).toBeDefined();
  });
});