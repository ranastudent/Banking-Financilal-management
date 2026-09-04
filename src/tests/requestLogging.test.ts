import request from "supertest";
import { describe, it, expect, vi } from "vitest";
import app from "../app";

describe("Request Logger", () => {
  it("should log request information after the response finishes", async () => {
    const consoleSpy = vi
      .spyOn(console, "log")
      .mockImplementation(() => {});

    await request(app).get("/health");

    const logs = consoleSpy.mock.calls.map((call) => call[0]);

    const requestLog = logs.find(
      (log) =>
        typeof log === "string" &&
        log.includes("[Request] GET /health") &&
        log.includes("status="),
    );

    expect(requestLog).toBeDefined();

    expect(requestLog).toMatch(
      /\[Request\] GET \/health requestId=[a-f0-9-]+/,
    );

    expect(requestLog).toMatch(/status=\d+/);
    expect(requestLog).toMatch(/duration=\d+\.\d+ms/);
    expect(requestLog).toMatch(
      /timestamp=\d{4}-\d{2}-\d{2}T/,
    );

    consoleSpy.mockRestore();
  });
});