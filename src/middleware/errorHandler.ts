import { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/AppError";
import { ErrorCode } from "../errors/errorCodes";
import { ZodError } from "zod";
import { logger } from "../observability/logger";
import { recordDatabaseError } from "../observability/metrics";

export const errorHandler = (
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) => {
  const requestId = req.requestId;

  // Request body too large
  if (
    error &&
    typeof error === "object" &&
    "type" in error &&
    error.type === "entity.too.large"
  ) {
    return res.status(413).json({
      success: false,
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "Request body is too large",
      },
      requestId,
    });
  }


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

  // Never serialize the raw error object: database/driver errors may include
  // SQL, connection strings, request data, or other sensitive values.
  const safeErrorName = error instanceof Error ? error.name : "UnknownError";
  const safeErrorCode =
    error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : undefined;
  const isDatabaseError =
    safeErrorName.toLowerCase().includes("prisma") ||
    safeErrorName.toLowerCase().includes("database") ||
    Boolean(safeErrorCode && /^P\d{4}$/.test(safeErrorCode));

  if (isDatabaseError) recordDatabaseError();

  logger.error("http.request.failed", {
    requestId,
    userId: req.user?.id ?? null,
    method: req.method,
    endpoint: req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path,
    errorName: safeErrorName,
    errorCode: safeErrorCode,
    category: isDatabaseError ? "database" : "application",
    // Detailed stack traces are development-only; never return them to clients.
    ...(process.env.NODE_ENV !== "production"
      ? { errorMessage: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined }
      : {}),
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