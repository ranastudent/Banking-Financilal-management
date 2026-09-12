import type { Request, Response } from "express";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import { authorizeFxRequestView } from "../services/fx-request.service";

export const getFxRequest = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const requestId = req.params.requestId;

  if (!req.user) {
    throw new AppError(
      "Authentication required",
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }

  if (typeof requestId !== "string" || requestId.trim() === "") {
    throw new AppError(
      "FX request ID is required",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  const fxRequest = await authorizeFxRequestView(
    requestId,
    req.user.id,
    req.user.role,
  );

  res.status(200).json({
    success: true,
    data: {
      fxRequest,
    },
    requestId: req.requestId,
  });
};