import type { Request, Response } from "express";

import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type {
  AuditorAuditLogParams,
  AuditorAuditLogQuery,
} from "../schemas/audit-log.schema";
import {
  getAuditorAuditLogById,
  getAuditorAuditLogs,
} from "../services/audit-log.service";

export const getAuditorAuditLogsController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  if (!req.user) {
    throw new AppError(
      "Authentication required",
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }

  const query =
    req.validatedQuery as AuditorAuditLogQuery;

  const filters = {
    ...(query.action !== undefined && {
      action: query.action,
    }),

    ...(query.entityType !== undefined && {
      entityType: query.entityType,
    }),

    ...(query.userId !== undefined && {
      userId: query.userId,
    }),
  };

  const result = await getAuditorAuditLogs(
    req.user,
    query.page,
    query.limit,
    filters,
  );

  res.status(200).json({
    success: true,
    data: result,
    requestId: req.requestId,
  });
};

export const getAuditorAuditLogController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  if (!req.user) {
    throw new AppError(
      "Authentication required",
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }

  const params =
    req.validatedParams as AuditorAuditLogParams;

  const auditLog =
    await getAuditorAuditLogById(
      req.user,
      params.auditLogId,
    );

  res.status(200).json({
    success: true,
    data: {
      auditLog,
    },
    requestId: req.requestId,
  });
};