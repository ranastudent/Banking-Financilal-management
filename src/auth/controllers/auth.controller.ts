import { Request, Response, NextFunction } from "express";
import { registerUser } from "../services/auth.service";
import { RegisterInput } from "../schemas/auth.schema";
import { sendSuccess } from "../../utils/apiResponse";

export const register = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const input = req.body as RegisterInput;

    const user = await registerUser(input, {
      requestId: req.requestId,
      ipAddress: req.ip,
      userAgent: req.get("user-agent") ?? undefined,
    });

    sendSuccess(
      res,
      req.requestId,
      user,
      201,
    );
  } catch (error) {
    next(error);
  }
};