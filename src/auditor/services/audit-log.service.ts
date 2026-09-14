import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type { AuthUser } from "../../types/auth";
import {
  assertAuditorPermission,
  AuditorPermission,
} from "../policies/auditor.policy";

const SAFE_AUDITOR_AUDIT_LOG_SELECT = {
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

type AuditorAuditLogFilters = {
  action?: string;
  entityType?: string;
  userId?: string;
};

export const getAuditorAuditLogs = async (
  user: AuthUser,
  page: number,
  limit: number,
  filters: AuditorAuditLogFilters = {},
) => {
  assertAuditorPermission(
    user,
    AuditorPermission.AUDIT_LOG_VIEW,
  );

  const skip = (page - 1) * limit;

  const where = {
    ...(filters.action !== undefined && {
      action: filters.action,
    }),

    ...(filters.entityType !== undefined && {
      entityType: filters.entityType,
    }),

    ...(filters.userId !== undefined && {
      userId: filters.userId,
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
      select: SAFE_AUDITOR_AUDIT_LOG_SELECT,
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

export const getAuditorAuditLogById = async (
  user: AuthUser,
  auditLogId: string,
) => {
  assertAuditorPermission(
    user,
    AuditorPermission.AUDIT_LOG_VIEW,
  );

  const auditLog =
    await prisma.auditLog.findUnique({
      where: {
        id: auditLogId,
      },
      select: SAFE_AUDITOR_AUDIT_LOG_SELECT,
    });

  if (!auditLog) {
    throw new AppError(
      "Audit log not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }

  return auditLog;
};