import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type { AuthUser } from "../../types/auth";

export const AUDITOR_ROLE = "AUDITOR" as const;

export const AuditorPermission = {
  AUDIT_LOG_VIEW: "AUDIT_LOG_VIEW",
  TRANSACTION_HISTORY_VIEW: "TRANSACTION_HISTORY_VIEW",
  ACCOUNT_ACTIVITY_VIEW: "ACCOUNT_ACTIVITY_VIEW",
  APPROVAL_RECORD_VIEW: "APPROVAL_RECORD_VIEW",
} as const;

export type AuditorPermission =
  (typeof AuditorPermission)[keyof typeof AuditorPermission];

const ALLOWED_AUDITOR_PERMISSIONS = new Set<AuditorPermission>([
  AuditorPermission.AUDIT_LOG_VIEW,
  AuditorPermission.TRANSACTION_HISTORY_VIEW,
  AuditorPermission.ACCOUNT_ACTIVITY_VIEW,
  AuditorPermission.APPROVAL_RECORD_VIEW,
]);

export const assertAuditorPermission = (
  user: AuthUser | undefined,
  permission: AuditorPermission,
): void => {
  if (!user) {
    throw new AppError(
      "Authentication required",
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }

  if (user.role !== AUDITOR_ROLE) {
    throw new AppError(
      "You do not have permission to access this resource",
      403,
      ErrorCode.FORBIDDEN,
    );
  }

  if (!ALLOWED_AUDITOR_PERMISSIONS.has(permission)) {
    throw new AppError(
      "You do not have permission to perform this action",
      403,
      ErrorCode.FORBIDDEN,
    );
  }
};