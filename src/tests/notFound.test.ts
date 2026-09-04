import request from "supertest";
import { describe, it, expect } from "vitest";
import app from "../app";

describe("404 Not Found Handler", () => {
  it("should return 404 for an unknown route", async () => {
    const response = await request(app)
      .get("/this-route-does-not-exist")
      .expect(404);

    expect(response.body.success).toBe(false);

    expect(response.body.error).toBeDefined();

    expect(response.body.error.code).toBe("NOT_FOUND");

    expect(response.body.error.message).toBe("Resource not found");

    expect(response.body.requestId).toBeDefined();
  });
});