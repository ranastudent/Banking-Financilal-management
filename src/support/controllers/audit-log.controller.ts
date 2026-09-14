import type { Request, Response } from "express";

import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type {
  SupportAuditLogParams,
  SupportAuditLogQuery,
} from "../schemas/audit-log.schema";
import {
  getSupportAuditLogById,
  getSupportAuditLogs,
} from "../services/audit-log.service";

export const getSupportAuditLogsController = async (
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
    req.validatedQuery as SupportAuditLogQuery;

  const result = await getSupportAuditLogs(
    req.user,
    query.page,
    query.limit,
    {
      ...(query.action !== undefined && {
        action: query.action,
      }),
      ...(query.entityType !== undefined && {
        entityType: query.entityType,
      }),
    },
  );

  res.status(200).json({
    success: true,
    data: result,
    requestId: req.requestId,
  });
};

export const getSupportAuditLogController = async (
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
    req.validatedParams as SupportAuditLogParams;

  const auditLog = await getSupportAuditLogById(
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