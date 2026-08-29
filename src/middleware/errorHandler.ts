import { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/AppError";
import { ErrorCode } from "../errors/errorCodes";
import { ZodError } from "zod";

export const errorHandler = (
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) => {
  const requestId = req.requestId;

  if (error instanceof ZodError) {
  return res.status(400).json({
    success: false,
    error: {
      code: "VALIDATION_ERROR",
      message: "Request validation failed",
    },
    requestId,
  });
}

  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
      },
      requestId,
    });
  }

  console.error("Unexpected error", {
    requestId,
    error,
  });

  return res.status(500).json({
    success: false,
    error: {
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      message: "Something went wrong",
    },
    requestId,
  });
};