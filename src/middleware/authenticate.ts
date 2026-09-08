import type { Request, Response, NextFunction } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";

import { env } from "../config/env";
import { AppError } from "../errors/AppError";
import { ErrorCode } from "../errors/errorCodes";
import type { AuthUser } from "../types/auth";

export const authenticate = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  const authorization = req.header("Authorization");

  if (!authorization) {
    throw new AppError(
      "Authentication required",
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }

  const [scheme, token] = authorization.trim().split(/\s+/);

  if (scheme !== "Bearer" || !token) {
    throw new AppError(
      "Invalid authorization header",
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }

  try {
    const decoded = jwt.verify(
      token,
      env.jwtAccessSecret,
    );

    if (
      typeof decoded === "string" ||
      !decoded ||
      typeof decoded !== "object"
    ) {
      throw new AppError(
        "Invalid access token",
        401,
        ErrorCode.UNAUTHORIZED,
      );
    }

    const payload = decoded as JwtPayload;

    if (
      typeof payload.sub !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.role !== "string" ||
      typeof payload.status !== "string"
    ) {
      throw new AppError(
        "Invalid access token payload",
        401,
        ErrorCode.UNAUTHORIZED,
      );
    }

    const user: AuthUser = {
      id: payload.sub,
      email: payload.email,
      role: payload.role as AuthUser["role"],
      status: payload.status as AuthUser["status"],
    };

    req.user = user;

    next();
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      "Invalid or expired access token",
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }
};