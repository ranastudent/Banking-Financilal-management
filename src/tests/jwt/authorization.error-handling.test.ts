import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { authorize } from "../../middleware/authorize";
import { ErrorCode } from "../../errors/errorCodes";

describe("Authorization Error Handling", () => {
  const response = {} as Response;

  it("should throw 401 when no authenticated user exists", () => {
    const req = {
      user: undefined,
    } as unknown as Request;

    const next = vi.fn() as NextFunction;

    expect(() => {
      authorize("ADMIN")(req, response, next);
    }).toThrow("Authentication required");

    expect(next).not.toHaveBeenCalled();
  });

  it("should use UNAUTHORIZED error code when user is not authenticated", () => {
    const req = {
      user: undefined,
    } as unknown as Request;

    const next = vi.fn() as NextFunction;

    try {
      authorize("ADMIN")(req, response, next);
      throw new Error("Expected authorize() to throw");
    } catch (error) {
      expect(error).toMatchObject({
        statusCode: 401,
        code: ErrorCode.UNAUTHORIZED,
      });
    }

    expect(next).not.toHaveBeenCalled();
  });

  it("should throw 403 when authenticated user has the wrong role", () => {
    const req = {
      user: {
        id: "user-123",
        email: "customer@example.com",
        role: "CUSTOMER",
        status: "ACTIVE",
      },
    } as unknown as Request;

    const next = vi.fn() as NextFunction;

    expect(() => {
      authorize("ADMIN")(req, response, next);
    }).toThrow("You do not have permission to access this resource");

    expect(next).not.toHaveBeenCalled();
  });

  it("should use FORBIDDEN error code for an authenticated user with the wrong role", () => {
    const req = {
      user: {
        id: "user-123",
        email: "customer@example.com",
        role: "CUSTOMER",
        status: "ACTIVE",
      },
    } as unknown as Request;

    const next = vi.fn() as NextFunction;

    try {
      authorize("ADMIN")(req, response, next);
      throw new Error("Expected authorize() to throw");
    } catch (error) {
      expect(error).toMatchObject({
        statusCode: 403,
        code: ErrorCode.FORBIDDEN,
      });
    }

    expect(next).not.toHaveBeenCalled();
  });

  it("should allow an authenticated user with the correct role", () => {
    const req = {
      user: {
        id: "admin-123",
        email: "admin@example.com",
        role: "ADMIN",
        status: "ACTIVE",
      },
    } as unknown as Request;

    const next = vi.fn() as NextFunction;

    authorize("ADMIN")(req, response, next);

    expect(next).toHaveBeenCalledOnce();
  });

    it("should not expose sensitive authentication data in the authorization error", () => {
    const req = {
        user: {
        id: "user-123",
        email: "customer@example.com",
        role: "CUSTOMER",
        status: "ACTIVE",
        },
    } as unknown as Request;

    const next = vi.fn() as NextFunction;

    try {
        authorize("ADMIN")(req, response, next);
        throw new Error("Expected authorize() to throw");
    } catch (error) {
        expect(error).not.toHaveProperty("token");
        expect(error).not.toHaveProperty("password");
        expect(error).not.toHaveProperty("passwordHash");
        expect(error).not.toHaveProperty("refreshToken");
    }
  });
});