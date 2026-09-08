import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { authorize } from "../../middleware/authorize";
import { ErrorCode } from "../../errors/errorCodes";

describe("Authorization Middleware - Unit Tests", () => {
  const response = {} as Response;

  const createRequest = (role?: string): Request =>
    ({
      user: role
        ? {
            id: "user-123",
            email: "user@example.com",
            role,
            status: "ACTIVE",
          }
        : undefined,
    }) as unknown as Request;

  it("should call next for an allowed role", () => {
    const req = createRequest("ADMIN");
    const next = vi.fn() as NextFunction;

    authorize("ADMIN")(req, response, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("should not call next for a disallowed role", () => {
    const req = createRequest("CUSTOMER");
    const next = vi.fn() as NextFunction;

    expect(() => {
      authorize("ADMIN")(req, response, next);
    }).toThrow();

    expect(next).not.toHaveBeenCalled();
  });

  it("should return 403 for a disallowed authenticated role", () => {
    const req = createRequest("CUSTOMER");
    const next = vi.fn() as NextFunction;

    try {
      authorize("ADMIN")(req, response, next);
    } catch (error) {
      expect(error).toMatchObject({
        statusCode: 403,
        code: ErrorCode.FORBIDDEN,
      });
    }

    expect(next).not.toHaveBeenCalled();
  });

  it("should allow any role listed in allowedRoles", () => {
    const req = createRequest("AUDITOR");
    const next = vi.fn() as NextFunction;

    authorize("ADMIN", "AUDITOR")(req, response, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("should reject a role not included in allowedRoles", () => {
    const req = createRequest("SUPPORT");
    const next = vi.fn() as NextFunction;

    expect(() => {
      authorize("ADMIN", "AUDITOR")(req, response, next);
    }).toThrow();

    expect(next).not.toHaveBeenCalled();
  });

  it("should return 401 when req.user is missing", () => {
    const req = createRequest();
    const next = vi.fn() as NextFunction;

    try {
      authorize("ADMIN")(req, response, next);
    } catch (error) {
      expect(error).toMatchObject({
        statusCode: 401,
        code: ErrorCode.UNAUTHORIZED,
      });
    }

    expect(next).not.toHaveBeenCalled();
  });

  it("should reject an empty allowed-role configuration", () => {
    const req = createRequest("ADMIN");
    const next = vi.fn() as NextFunction;

    expect(() => {
      authorize()(req, response, next);
    }).toThrow();

    expect(next).not.toHaveBeenCalled();
  });

  it("should not modify req.user", () => {
    const req = createRequest("ADMIN");
    const originalUser = req.user;
    const next = vi.fn() as NextFunction;

    authorize("ADMIN")(req, response, next);

    expect(req.user).toEqual(originalUser);
  });

  it("should work independently of the response object", () => {
    const req = createRequest("ADMIN");
    const next = vi.fn() as NextFunction;

    authorize("ADMIN")(req, {} as Response, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("should never call next when authentication is missing", () => {
    const req = createRequest();
    const next = vi.fn() as NextFunction;

    expect(() => {
      authorize("CUSTOMER")(req, response, next);
    }).toThrow("Authentication required");

    expect(next).not.toHaveBeenCalled();
  });
});