import type { AuthUser } from "../../types/auth";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";

export const SUPPORT_ROLE = "SUPPORT" as const;

export const SupportPermission = {
  CUSTOMER_LOOKUP: "CUSTOMER_LOOKUP",
  CUSTOMER_ACCOUNT_VIEW: "CUSTOMER_ACCOUNT_VIEW",
  CUSTOMER_TRANSACTION_VIEW: "CUSTOMER_TRANSACTION_VIEW",
  BENEFICIARY_ASSISTANCE: "BENEFICIARY_ASSISTANCE",
  SUPPORT_AUDIT_VIEW: "SUPPORT_AUDIT_VIEW",
} as const;

export type SupportPermission =
  (typeof SupportPermission)[keyof typeof SupportPermission];

const SUPPORT_ALLOWED_PERMISSIONS = new Set<SupportPermission>([
  SupportPermission.CUSTOMER_LOOKUP,
  SupportPermission.CUSTOMER_ACCOUNT_VIEW,
  SupportPermission.CUSTOMER_TRANSACTION_VIEW,
  SupportPermission.BENEFICIARY_ASSISTANCE,
  SupportPermission.SUPPORT_AUDIT_VIEW,
]);

/**
 * Defense-in-depth SUPPORT authorization.
 *
 * Route-level authorization should still use:
 *
 * authenticate
 * authorize("SUPPORT")
 *
 * This policy protects business/service operations from being called
 * directly without the required SUPPORT role.
 */
export const assertSupportPermission = (
  user: AuthUser | undefined,
  permission: SupportPermission,
): AuthUser => {
  if (!user) {
    throw new AppError(
      "Authentication required",
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }

  if (user.role !== SUPPORT_ROLE) {
    throw new AppError(
      "You do not have permission to perform this support operation",
      403,
      ErrorCode.FORBIDDEN,
    );
  }

  if (!SUPPORT_ALLOWED_PERMISSIONS.has(permission)) {
    throw new AppError(
      "This support operation is not permitted",
      403,
      ErrorCode.FORBIDDEN,
    );
  }

  return user;
};