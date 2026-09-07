import { Request, Response, NextFunction } from "express";

import type { RefreshTokenInput } from "../schemas/refresh-token.schema";
import { refreshAccessToken } from "../services/refresh-token.service";
import { sendSuccess } from "../../utils/apiResponse";

export const refreshToken = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input = req.body as RefreshTokenInput;

    const result = await refreshAccessToken(input);

    sendSuccess(
      res,
      req.requestId,
      result,
      200,
    );
  } catch (error) {
    next(error);
  }
};