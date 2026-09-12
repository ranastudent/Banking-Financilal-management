import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";

const SAFE_AUDIT_LOG_SELECT = {
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

export const getAdminAuditLogs = async (
  page: number,
  limit: number,
) => {
  const skip = (page - 1) * limit;

  const [auditLogs, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      skip,
      take: limit,
      orderBy: {
        createdAt: "desc",
      },
      select: SAFE_AUDIT_LOG_SELECT,
    }),

    prisma.auditLog.count(),
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

export const getAdminAuditLogById = async (
  auditLogId: string,
) => {
  const auditLog = await prisma.auditLog.findUnique({
    where: {
      id: auditLogId,
    },
    select: SAFE_AUDIT_LOG_SELECT,
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