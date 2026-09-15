import { describe, expect, it, vi } from "vitest";

import { authorize } from "../../middleware/authorize";

const createMockRequest = (user?: {
  id: string;
  email: string;
  role: "CUSTOMER" | "ADMIN" | "SUPPORT" | "AUDITOR";
  status: "ACTIVE" | "INACTIVE" | "SUSPENDED" | "BLOCKED";
}) => {
  return {
    user,
  } as any;
};

const createMockResponse = () => {
  return {} as any;
};

describe("JWT Role Authorization Middleware", () => {
  it("should reject unauthenticated requests when req.user is missing", () => {
    const req = createMockRequest();
    const res = createMockResponse();
    const next = vi.fn();

    expect(() => {
      authorize("ADMIN")(req, res, next);
    }).toThrowError("Authentication required");

    expect(next).not.toHaveBeenCalled();
  });

  it("should allow a user whose role is explicitly permitted", () => {
    const req = createMockRequest({
      id: "customer-1",
      email: "customer@example.com",
      role: "CUSTOMER",
      status: "ACTIVE",
    });

    const res = createMockResponse();
    const next = vi.fn();

    authorize("CUSTOMER")(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]).toBeUndefined();
  });

  it("should deny a user whose role is not permitted", () => {
    const req = createMockRequest({
      id: "customer-1",
      email: "customer@example.com",
      role: "CUSTOMER",
      status: "ACTIVE",
    });

    const res = createMockResponse();
    const next = vi.fn();

    expect(() => {
      authorize("ADMIN")(req, res, next);
    }).toThrowError(
      "You do not have permission to access this resource",
    );

    expect(next).not.toHaveBeenCalled();
  });

  it("should allow a role when multiple roles are permitted", () => {
    const req = createMockRequest({
      id: "admin-1",
      email: "admin@example.com",
      role: "ADMIN",
      status: "ACTIVE",
    });

    const res = createMockResponse();
    const next = vi.fn();

    authorize("CUSTOMER", "ADMIN")(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]).toBeUndefined();
  });

  it("should deny a role when it is absent from the allowed roles", () => {
    const req = createMockRequest({
      id: "auditor-1",
      email: "auditor@example.com",
      role: "AUDITOR",
      status: "ACTIVE",
    });

    const res = createMockResponse();
    const next = vi.fn();

    expect(() => {
      authorize("CUSTOMER", "ADMIN", "SUPPORT")(
        req,
        res,
        next,
      );
    }).toThrowError(
      "You do not have permission to access this resource",
    );

    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    "CUSTOMER",
    "ADMIN",
    "SUPPORT",
    "AUDITOR",
  ] as const)(
    "should allow %s when that role is explicitly authorized",
    (role) => {
      const req = createMockRequest({
        id: `${role.toLowerCase()}-1`,
        email: `${role.toLowerCase()}@example.com`,
        role,
        status: "ACTIVE",
      });

      const res = createMockResponse();
      const next = vi.fn();

      authorize(role)(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next.mock.calls[0]?.[0]).toBeUndefined();
    },
  );
});