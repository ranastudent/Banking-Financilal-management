import type { Request, Response } from "express";

import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import {
  getCurrentUser,
  updateCurrentUser,
} from "../services/user.service";
import type { UpdateMyProfileInput } from "../schemas/user.schema";

export const getMyProfile = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = req.user?.id;

  if (!userId) {
    throw new AppError(
      "Authentication required",
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }

  const user = await getCurrentUser(userId);

  if (!user) {
    throw new AppError(
      "User not found",
      404,
      ErrorCode.NOT_FOUND,
    );
  }

  res.status(200).json({
    success: true,
    data: user,
    requestId: req.requestId,
  });
};

export const updateMyProfile = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = req.user?.id;

  if (!userId) {
    throw new AppError(
      "Authentication required",
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }

  const input = req.body as UpdateMyProfileInput;

  const user = await updateCurrentUser(userId, input);

  res.status(200).json({
    success: true,
    data: user,
    requestId: req.requestId,
  });
};