import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import http from "node:http";

import { requestLogger } from "../../middleware/requestLogger";

describe("Sensitive Data Logging", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should not log sensitive request data", () => {
    const server = http.createServer();

    const req = {
      method: "POST",
      originalUrl: "/login",
      requestId: "test-request-id",
    } as any;

    const res = {
      statusCode: 200,
      on: vi.fn((event: string, callback: () => void) => {
        if (event === "finish") {
          callback();
        }
        return res;
      }),
    } as any;

    const next = vi.fn();

    requestLogger(req, res, next);

    const logCalls = (
      console.log as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;

    const logs = logCalls
      .flat()
      .map(String)
      .join(" ");

    expect(logs).toContain("[Request]");
    expect(logs).toContain("POST");
    expect(logs).toContain("/login");

    expect(logs).not.toContain("password");
    expect(logs).not.toContain("token");
    expect(logs).not.toContain("otp");
    expect(logs).not.toContain("authorization");
    expect(logs).not.toContain("secret");
  });

  it("should omit query-string values from request logs", () => {
    const req = {
      method: "GET",
      path: "/auth/verify-email",
      originalUrl: "/auth/verify-email?token=super-secret-token&email=user@example.com",
      requestId: "safe-request-id",
    } as any;

    const res = {
      statusCode: 200,
      on: vi.fn((event: string, callback: () => void) => {
        if (event === "finish") callback();
        return res;
      }),
    } as any;

    requestLogger(req, res, vi.fn());

    const logs = (console.log as any).mock.calls.flat().map(String).join(" ");
    expect(logs).toContain("/auth/verify-email");
    expect(logs).not.toContain("super-secret-token");
    expect(logs).not.toContain("user@example.com");
  });

  it("should only log safe request metadata", () => {
    const server = http.createServer();

    const req = {
      method: "GET",
      originalUrl: "/health",
      requestId: "safe-request-id",
    } as any;

    const res = {
      statusCode: 200,
      on: vi.fn((event: string, callback: () => void) => {
        if (event === "finish") {
          callback();
        }
        return res;
      }),
    } as any;

    const next = vi.fn();

    requestLogger(req, res, next);

    const logCalls = (
      console.log as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;

    const logs = logCalls
      .flat()
      .map(String)
      .join(" ");

    expect(logs).toContain("[Request]");
    expect(logs).toContain("GET");
    expect(logs).toContain("/health");
    expect(logs).toContain("requestId=safe-request-id");
    expect(logs).toContain("status=200");
    expect(logs).toMatch(/duration=\d+\.\d+ms/);
    expect(logs).toContain("timestamp=");

    expect(logs).not.toContain("password");
    expect(logs).not.toContain("token");
    expect(logs).not.toContain("otp");
    expect(logs).not.toContain("authorization");
    expect(logs).not.toContain("secret");
  });
});