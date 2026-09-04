import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";

describe("Application Startup", () => {
  it("should load the Express application successfully", () => {
    expect(app).toBeDefined();
    expect(typeof app).toBe("function");
  });

  it("should respond to an HTTP request", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(600);
  });
});