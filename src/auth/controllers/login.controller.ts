import { Request, Response, NextFunction } from "express";

import type { LoginInput } from "../schemas/auth.schema";
import { loginUser } from "../services/login.service";
import { sendSuccess } from "../../utils/apiResponse";

export const login = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input = req.body as LoginInput;

    const result = await loginUser(input);

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