import type { Request, Response } from "express";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import {
  getUserNotifications,
  markUserNotificationAsRead,
} from "../services/notification.service";

const parsePositiveInteger = (
  value: unknown,
  fallback: number,
  field: string,
  max?: number,
): number => {
  if (value === undefined) return fallback;

  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new AppError(
      `${field} must be a positive integer`,
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new AppError(
      `${field} must be a positive integer`,
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  if (max !== undefined && parsed > max) {
    throw new AppError(
      `${field} must not exceed ${max}`,
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  return parsed;
};

export const getNotifications = async (
  req: Request,
  res: Response,
): Promise<void> => {
  if (!req.user) {
    throw new AppError("Authentication required", 401, ErrorCode.UNAUTHORIZED);
  }

  const page = parsePositiveInteger(req.query.page, 1, "page");
  const limit = parsePositiveInteger(req.query.limit, 20, "limit", 100);
  let unreadOnly = false;
  if (req.query.unreadOnly !== undefined) {
    if (req.query.unreadOnly !== "true" && req.query.unreadOnly !== "false") {
      throw new AppError("unreadOnly must be true or false", 400, ErrorCode.BAD_REQUEST);
    }
    unreadOnly = req.query.unreadOnly === "true";
  }

  const data = await getUserNotifications(req.user.id, { page, limit, unreadOnly });
  res.status(200).json({ success: true, data, requestId: req.requestId });
};

export const markNotificationAsRead = async (
  req: Request,
  res: Response,
): Promise<void> => {
  if (!req.user) {
    throw new AppError("Authentication required", 401, ErrorCode.UNAUTHORIZED);
  }

  const notificationId = req.params.id;
  if (typeof notificationId !== "string" || notificationId.trim() === "") {
    throw new AppError("Notification ID is required", 400, ErrorCode.BAD_REQUEST);
  }

  const notification = await markUserNotificationAsRead(req.user.id, notificationId);
  res.status(200).json({
    success: true,
    data: { notification },
    requestId: req.requestId,
  });
};
