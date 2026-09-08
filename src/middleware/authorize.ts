import type { Request, Response, NextFunction } from "express";

import { AppError } from "../errors/AppError";
import { ErrorCode } from "../errors/errorCodes";

export const authorize = (...allowedRoles: string[]) => {
  return (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): void => {
    if (!req.user) {
      throw new AppError(
        "Authentication required",
        401,
        ErrorCode.UNAUTHORIZED,
      );
    }

    if (!allowedRoles.includes(req.user.role)) {
      throw new AppError(
        "You do not have permission to access this resource",
        403,
        ErrorCode.FORBIDDEN,
      );
    }

    next();
  };
};