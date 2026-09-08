import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { authorize } from "../../middleware/authorize";

describe("Role Validation", () => {
  const createRequest = (role: string): Request =>
    ({
      user: {
        id: "user-123",
        email: "user@example.com",
        role,
        status: "ACTIVE",
      },
    }) as Request;

  const response = {} as Response;

  it("should allow CUSTOMER when CUSTOMER role is permitted", () => {
    const req = createRequest("CUSTOMER");
    const next = vi.fn() as NextFunction;

    authorize("CUSTOMER")(req, response, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("should allow ADMIN when ADMIN role is permitted", () => {
    const req = createRequest("ADMIN");
    const next = vi.fn() as NextFunction;

    authorize("ADMIN")(req, response, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("should allow SUPPORT when SUPPORT role is permitted", () => {
    const req = createRequest("SUPPORT");
    const next = vi.fn() as NextFunction;

    authorize("SUPPORT")(req, response, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("should allow AUDITOR when AUDITOR role is permitted", () => {
    const req = createRequest("AUDITOR");
    const next = vi.fn() as NextFunction;

    authorize("AUDITOR")(req, response, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("should reject CUSTOMER when only ADMIN is permitted", () => {
    const req = createRequest("CUSTOMER");
    const next = vi.fn() as NextFunction;

    expect(() => {
      authorize("ADMIN")(req, response, next);
    }).toThrow("You do not have permission to access this resource");

    expect(next).not.toHaveBeenCalled();
  });

  it("should reject SUPPORT when only ADMIN is permitted", () => {
    const req = createRequest("SUPPORT");
    const next = vi.fn() as NextFunction;

    expect(() => {
      authorize("ADMIN")(req, response, next);
    }).toThrow("You do not have permission to access this resource");

    expect(next).not.toHaveBeenCalled();
  });

  it("should allow ADMIN when ADMIN or AUDITOR is permitted", () => {
    const req = createRequest("ADMIN");
    const next = vi.fn() as NextFunction;

    authorize("ADMIN", "AUDITOR")(req, response, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("should allow AUDITOR when ADMIN or AUDITOR is permitted", () => {
    const req = createRequest("AUDITOR");
    const next = vi.fn() as NextFunction;

    authorize("ADMIN", "AUDITOR")(req, response, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("should reject CUSTOMER when ADMIN or AUDITOR is permitted", () => {
    const req = createRequest("CUSTOMER");
    const next = vi.fn() as NextFunction;

    expect(() => {
      authorize("ADMIN", "AUDITOR")(req, response, next);
    }).toThrow("You do not have permission to access this resource");

    expect(next).not.toHaveBeenCalled();
  });

  it("should reject a request when no authenticated user exists", () => {
    const req = {
        user: undefined,
    } as unknown as Request;

    const next = vi.fn() as NextFunction;

    expect(() => {
        authorize("ADMIN")(req, response, next);
    }).toThrow("Authentication required");

    expect(next).not.toHaveBeenCalled();
  });
});