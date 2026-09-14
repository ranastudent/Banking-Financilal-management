import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type { AuthUser } from "../../types/auth";
import {
  assertSupportPermission,
  SupportPermission,
} from "../policies/support.policy";

const SAFE_SUPPORT_AUDIT_LOG_SELECT = {
  id: true,
  userId: true,
  action: true,
  entityType: true,
  entityId: true,
  description: true,
  ipAddress: true,
  userAgent: true,
  metadata: true,
  createdAt: true,

  user: {
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
    },
  },
} as const;

type SupportAuditLogFilters = {
  action?: string;
  entityType?: string;
};

export const getSupportAuditLogs = async (
  user: AuthUser,
  page: number,
  limit: number,
  filters: SupportAuditLogFilters = {},
) => {
  assertSupportPermission(
    user,
    SupportPermission.SUPPORT_AUDIT_VIEW,
  );

  const skip = (page - 1) * limit;

  const where = {
    user: {
      role: "SUPPORT" as const,
    },

    action:
      filters.action !== undefined
        ? filters.action
        : {
            startsWith: "SUPPORT_",
          },

    ...(filters.entityType !== undefined && {
      entityType: filters.entityType,
    }),
  };

  const [auditLogs, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      skip,
      take: limit,
      orderBy: {
        createdAt: "desc",
      },
      select: SAFE_SUPPORT_AUDIT_LOG_SELECT,
    }),

    prisma.auditLog.count({
      where,
    }),
  ]);

  return {
    auditLogs,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const getSupportAuditLogById = async (
  user: AuthUser,
  auditLogId: string,
) => {
  assertSupportPermission(
    user,
    SupportPermission.SUPPORT_AUDIT_VIEW,
  );

  const auditLog =
    await prisma.auditLog.findFirst({
      where: {
        id: auditLogId,
        user: {
          role: "SUPPORT",
        },
        action: {
          startsWith: "SUPPORT_",
        },
      },
      select: SAFE_SUPPORT_AUDIT_LOG_SELECT,
    });

  if (!auditLog) {
    throw new AppError(
      "Support audit log not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }

  return auditLog;
};