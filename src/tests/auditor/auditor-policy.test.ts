import { describe, expect, it } from "vitest";

import {
  assertAuditorPermission,
  AuditorPermission,
} from "../../auditor/policies/auditor.policy";

import type { AuthUser } from "../../types/auth";

const createAuditor = (): AuthUser => ({
  id: "auditor-1",
  email: "auditor@example.com",
  role: "AUDITOR",
  status: "ACTIVE",
});

const createUser = (
  role: "CUSTOMER" | "ADMIN" | "SUPPORT" | "AUDITOR",
): AuthUser => ({
  id: `${role.toLowerCase()}-1`,
  email: `${role.toLowerCase()}@example.com`,
  role,
  status: "ACTIVE",
});

describe("9.9.6 AUDITOR Authorization Policy", () => {
  it("should reject unauthenticated access", () => {
    expect(() => {
      assertAuditorPermission(
        undefined,
        AuditorPermission.AUDIT_LOG_VIEW,
      );
    }).toThrowError("Authentication required");
  });

  it.each([
    "CUSTOMER",
    "ADMIN",
    "SUPPORT",
  ] as const)(
    "should reject %s from AUDITOR permissions",
    (role) => {
      expect(() => {
        assertAuditorPermission(
          createUser(role),
          AuditorPermission.AUDIT_LOG_VIEW,
        );
      }).toThrowError(
        "You do not have permission to access this resource",
      );
    },
  );

  it("should allow AUDITOR to view audit logs", () => {
    expect(() => {
      assertAuditorPermission(
        createAuditor(),
        AuditorPermission.AUDIT_LOG_VIEW,
      );
    }).not.toThrow();
  });

  it("should allow AUDITOR to view transaction history", () => {
    expect(() => {
      assertAuditorPermission(
        createAuditor(),
        AuditorPermission.TRANSACTION_HISTORY_VIEW,
      );
    }).not.toThrow();
  });

  it("should allow AUDITOR to view account activity", () => {
    expect(() => {
      assertAuditorPermission(
        createAuditor(),
        AuditorPermission.ACCOUNT_ACTIVITY_VIEW,
      );
    }).not.toThrow();
  });

  it("should allow AUDITOR to view approval records", () => {
    expect(() => {
      assertAuditorPermission(
        createAuditor(),
        AuditorPermission.APPROVAL_RECORD_VIEW,
      );
    }).not.toThrow();
  });

  it("should allow AUDITOR to view FX request history", () => {
    expect(() => {
      assertAuditorPermission(
        createAuditor(),
        AuditorPermission.FX_REQUEST_HISTORY_VIEW,
      );
    }).not.toThrow();
  });

  it("should deny an unsupported AUDITOR permission", () => {
    expect(() => {
      assertAuditorPermission(
        createAuditor(),
        "UNSUPPORTED_PERMISSION" as never,
      );
    }).toThrowError(
      "You do not have permission to perform this action",
    );
  });
});