import type { Request, Response } from "express";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import {
  getAdminUserById,
  getAdminUsers,
} from "../services/user.service";

export const getUsers = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const rawPage = req.query.page;
  const rawLimit = req.query.limit;

  const page =
    typeof rawPage === "string" && rawPage.trim() !== ""
      ? Number(rawPage)
      : 1;

  const limit =
    typeof rawLimit === "string" && rawLimit.trim() !== ""
      ? Number(rawLimit)
      : 20;

  if (
    !Number.isInteger(page) ||
    page < 1
  ) {
    throw new AppError(
      "Page must be a positive integer",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    throw new AppError(
      "Limit must be between 1 and 100",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  const result = await getAdminUsers(page, limit);

  res.status(200).json({
    success: true,
    data: result,
    requestId: req.requestId,
  });
};

export const getUser = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = req.params.userId;

  if (
    typeof userId !== "string" ||
    userId.trim() === ""
  ) {
    throw new AppError(
      "User ID is required",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  const user = await getAdminUserById(userId);

  res.status(200).json({
    success: true,
    data: {
      user,
    },
    requestId: req.requestId,
  });
};