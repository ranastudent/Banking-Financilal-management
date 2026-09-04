import request from "supertest";
import { describe, expect, it } from "vitest";
import app from "../app";

describe("Security Headers", () => {
  it("should include security headers in the response", async () => {
    const response = await request(app)
      .get("/health");

    expect(response.headers["x-content-type-options"]).toBe("nosniff");

    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");

    expect(response.headers["strict-transport-security"]).toBeDefined();

    expect(response.headers["content-security-policy"]).toBeDefined();

    expect(response.headers["referrer-policy"]).toBeDefined();
  });
});