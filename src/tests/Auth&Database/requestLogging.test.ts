import "../setup";
import request from "supertest";
import { afterEach, describe, it, expect, vi } from "vitest";
import app from "../../app";

describe("Request Logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes structured JSON request information after the response finishes", async () => {
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const response = await request(app).get("/health");

    const logRecords = consoleSpy.mock.calls
      .map((call) => call[0])
      .filter((value): value is string => typeof value === "string")
      .map((value) => {
        try {
          return JSON.parse(value) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((value): value is Record<string, unknown> => value !== null);

    const requestLog = logRecords.find(
      (record) => record.event === "http.request.completed",
    );

    expect(response.status).toBe(200);
    expect(requestLog).toBeDefined();
    expect(requestLog).toMatchObject({
      level: "info",
      event: "http.request.completed",
      method: "GET",
      endpoint: "/health",
      status: 200,
      requestId: expect.any(String),
      startedAt: expect.any(String),
      latencyMs: expect.any(Number),
    });
    expect(requestLog?.timestamp).toEqual(expect.any(String));
  });
});
