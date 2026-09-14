import type { AuthUser } from "../../types/auth";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";

export const AUDITOR_ROLE = "AUDITOR" as const;

export const AuditorPermission = {
  AUDIT_LOG_VIEW: "AUDIT_LOG_VIEW",
} as const;

export type AuditorPermission =
  (typeof AuditorPermission)[keyof typeof AuditorPermission];

const AUDITOR_ALLOWED_PERMISSIONS =
  new Set<AuditorPermission>([
    AuditorPermission.AUDIT_LOG_VIEW,
  ]);

export const assertAuditorPermission = (
  user: AuthUser | undefined,
  permission: AuditorPermission,
): AuthUser => {
  if (!user) {
    throw new AppError(
      "Authentication required",
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }

  if (user.role !== AUDITOR_ROLE) {
    throw new AppError(
      "You do not have permission to perform this auditor operation",
      403,
      ErrorCode.FORBIDDEN,
    );
  }

  if (!AUDITOR_ALLOWED_PERMISSIONS.has(permission)) {
    throw new AppError(
      "This auditor operation is not permitted",
      403,
      ErrorCode.FORBIDDEN,
    );
  }

  return user;
};