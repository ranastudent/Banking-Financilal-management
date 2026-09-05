import { Request, Response, NextFunction } from "express";
import type { VerifyEmailInput } from "../schemas/verifyEmail.schema";
import { verifyEmail } from "../services/verify-email.service";
import { sendSuccess } from "../../utils/apiResponse";

export const verifyEmailController = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input = req.body as VerifyEmailInput;

    const user = await verifyEmail(input);

    sendSuccess(
      res,
      req.requestId,
      user,
      200,
    );
  } catch (error) {
    next(error);
  }
};