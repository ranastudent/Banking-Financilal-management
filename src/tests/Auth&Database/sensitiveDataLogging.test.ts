import "../setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requestLogger } from "../../middleware/requestLogger";

describe("Sensitive Data Logging", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const invokeRequestLogger = (request: Record<string, unknown>) => {
    const req = request as any;

    const res = {
      statusCode: 200,
      on: vi.fn((event: string, callback: () => void) => {
        if (event === "finish") callback();
        return res;
      }),
    } as any;

    const next = vi.fn();
    requestLogger(req, res, next);
    expect(next).toHaveBeenCalledOnce();

    return (console.info as unknown as {
      mock: { calls: unknown[][] };
    }).mock.calls
      .flat()
      .map(String)
      .join(" ");
  };

  it("should not log sensitive request data", () => {
    const logs = invokeRequestLogger({
      method: "POST",
      path: "/login",
      originalUrl: "/login",
      requestId: "test-request-id",
      body: {
        password: "secret-password",
        token: "secret-token",
        otp: "123456",
        authorization: "Bearer secret",
        secret: "private-value",
      },
      headers: {
        authorization: "Bearer secret",
      },
    });

    expect(logs).toContain('"event":"http.request.completed"');
    expect(logs).toContain('"method":"POST"');
    expect(logs).toContain('"endpoint":"/login"');
    expect(logs).toContain('"requestId":"test-request-id"');

    expect(logs).not.toContain("secret-password");
    expect(logs).not.toContain("secret-token");
    expect(logs).not.toContain("123456");
    expect(logs).not.toContain("Bearer secret");
    expect(logs).not.toContain("private-value");
    expect(logs).not.toContain('"password"');
    expect(logs).not.toContain('"authorization"');
  });

  it("should omit query-string values from request logs", () => {
    const logs = invokeRequestLogger({
      method: "GET",
      path: "/auth/verify-email",
      originalUrl:
        "/auth/verify-email?token=super-secret-token&email=user@example.com",
      requestId: "safe-request-id",
    });

    expect(logs).toContain('"endpoint":"/auth/verify-email"');
    expect(logs).not.toContain("super-secret-token");
    expect(logs).not.toContain("user@example.com");
  });

  it("should only log safe request metadata", () => {
    const logs = invokeRequestLogger({
      method: "GET",
      path: "/health",
      originalUrl: "/health",
      requestId: "safe-request-id",
      ip: "127.0.0.1",
    });

    expect(logs).toContain('"event":"http.request.completed"');
    expect(logs).toContain('"method":"GET"');
    expect(logs).toContain('"endpoint":"/health"');
    expect(logs).toContain('"requestId":"safe-request-id"');
    expect(logs).toContain('"status":200');
    expect(logs).toMatch(/"latencyMs":\d+(\.\d+)?/);
    expect(logs).toContain('"timestamp":');
    expect(logs).not.toContain("password");
    expect(logs).not.toContain("token");
    expect(logs).not.toContain("otp");
    expect(logs).not.toContain("authorization");
    expect(logs).not.toContain("secret");
  });
});
