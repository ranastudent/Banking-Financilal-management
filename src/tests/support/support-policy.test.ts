import {
  describe,
  expect,
  it,
} from "vitest";

import type { AuthUser } from "../../types/auth";
import {
  assertSupportPermission,
  SupportPermission,
} from "../../support/policies/support.policy";

describe("SUPPORT Authorization Policy", () => {
  const supportUser: AuthUser = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    email: "support@example.com",
    role: "SUPPORT",
    status: "ACTIVE",
  };

  const adminUser: AuthUser = {
    id: "550e8400-e29b-41d4-a716-446655440001",
    email: "admin@example.com",
    role: "ADMIN",
    status: "ACTIVE",
  };

  const customerUser: AuthUser = {
    id: "550e8400-e29b-41d4-a716-446655440002",
    email: "customer@example.com",
    role: "CUSTOMER",
    status: "ACTIVE",
  };

  const auditorUser: AuthUser = {
    id: "550e8400-e29b-41d4-a716-446655440003",
    email: "auditor@example.com",
    role: "AUDITOR",
    status: "ACTIVE",
  };

  it("should allow SUPPORT to perform customer lookup", () => {
    expect(() =>
      assertSupportPermission(
        supportUser,
        SupportPermission.CUSTOMER_LOOKUP,
      ),
    ).not.toThrow();
  });

  it("should allow SUPPORT to view customer accounts", () => {
    expect(() =>
      assertSupportPermission(
        supportUser,
        SupportPermission.CUSTOMER_ACCOUNT_VIEW,
      ),
    ).not.toThrow();
  });

  it("should allow SUPPORT to view customer transactions", () => {
    expect(() =>
      assertSupportPermission(
        supportUser,
        SupportPermission.CUSTOMER_TRANSACTION_VIEW,
      ),
    ).not.toThrow();
  });

  it("should allow SUPPORT beneficiary assistance", () => {
    expect(() =>
      assertSupportPermission(
        supportUser,
        SupportPermission.BENEFICIARY_ASSISTANCE,
      ),
    ).not.toThrow();
  });

  it("should allow SUPPORT to view the support audit trail", () => {
    expect(() =>
      assertSupportPermission(
        supportUser,
        SupportPermission.SUPPORT_AUDIT_VIEW,
      ),
    ).not.toThrow();
  });

  it("should reject unauthenticated access", () => {
    expect(() =>
      assertSupportPermission(
        undefined,
        SupportPermission.CUSTOMER_LOOKUP,
      ),
    ).toThrow("Authentication required");
  });

  it("should reject ADMIN from SUPPORT-only operations", () => {
    expect(() =>
      assertSupportPermission(
        adminUser,
        SupportPermission.CUSTOMER_LOOKUP,
      ),
    ).toThrow(
      "You do not have permission to perform this support operation",
    );
  });

  it("should reject CUSTOMER from SUPPORT-only operations", () => {
    expect(() =>
      assertSupportPermission(
        customerUser,
        SupportPermission.CUSTOMER_LOOKUP,
      ),
    ).toThrow(
      "You do not have permission to perform this support operation",
    );
  });

  it("should reject AUDITOR from SUPPORT-only operations", () => {
    expect(() =>
      assertSupportPermission(
        auditorUser,
        SupportPermission.CUSTOMER_LOOKUP,
      ),
    ).toThrow(
      "You do not have permission to perform this support operation",
    );
  });

  it("should return the authenticated SUPPORT user", () => {
    const result = assertSupportPermission(
      supportUser,
      SupportPermission.CUSTOMER_LOOKUP,
    );

    expect(result).toEqual(supportUser);
  });

  it("should enforce deny-by-default for unsupported permissions", () => {
    expect(() =>
      assertSupportPermission(
        supportUser,
        "TRANSFER_EXECUTE" as SupportPermission,
      ),
    ).toThrow("This support operation is not permitted");
  });
});