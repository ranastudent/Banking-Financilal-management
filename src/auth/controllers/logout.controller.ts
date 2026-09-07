import { Request, Response, NextFunction } from "express";

import type { RefreshTokenInput } from "../schemas/refresh-token.schema";
import { logoutUser } from "../services/logout.service";
import { sendSuccess } from "../../utils/apiResponse";

export const logout = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input = req.body as RefreshTokenInput;

    await logoutUser(input);

    sendSuccess(
      res,
      req.requestId,
      {
        message: "Logout successful",
      },
      200,
    );
  } catch (error) {
    next(error);
  }
};