import type { Request, Response, NextFunction } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";

import { env } from "../config/env";
import { AppError } from "../errors/AppError";
import { ErrorCode } from "../errors/errorCodes";
import type { AuthUser } from "../types/auth";
import { extractBearerToken } from "../utils/bearerToken";

export const authenticate = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  const authorization = req.header("Authorization");

  let token: string;

  // ------------------------------------------------------------
  // 1. Extract Bearer token
  // ------------------------------------------------------------

  try {
    token = extractBearerToken(authorization);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Authentication required"
    ) {
      throw new AppError(
        "Authentication required",
        401,
        ErrorCode.UNAUTHORIZED,
      );
    }

    throw new AppError(
      "Invalid authorization header",
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }

  // ------------------------------------------------------------
  // 2. Verify JWT access token
  // ------------------------------------------------------------

  try {
    const decoded = jwt.verify(
      token,
      env.jwtAccessSecret,
    );

    // ----------------------------------------------------------
    // 3. Make sure decoded JWT is an object
    // ----------------------------------------------------------

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

    // ----------------------------------------------------------
    // 4. Validate access-token payload
    // ----------------------------------------------------------

    if (
      typeof payload.sub !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.role !== "string" ||
      typeof payload.status !== "string" ||
      payload.tokenType !== "access"
    ) {
      throw new AppError(
        "Invalid access token payload",
        401,
        ErrorCode.UNAUTHORIZED,
      );
    }

    // ----------------------------------------------------------
    // 5. Build authenticated user
    // ----------------------------------------------------------

    const user: AuthUser = {
      id: payload.sub,
      email: payload.email,
      role: payload.role as AuthUser["role"],
      status: payload.status as AuthUser["status"],
    };

    // ----------------------------------------------------------
    // 6. Attach authenticated user to request
    // ----------------------------------------------------------

    req.user = user;

    // ----------------------------------------------------------
    // 7. Continue request
    // ----------------------------------------------------------

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