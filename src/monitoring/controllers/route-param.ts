import type { Request } from "express";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";

/** Read a required Express route parameter safely (Express 5 permits arrays). */
export const requireRouteParam = (req: Request, name: string): string => {
  const value = req.params[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError(`Missing or invalid route parameter: ${name}`, 400, ErrorCode.BAD_REQUEST);
  }
  return value;
};
