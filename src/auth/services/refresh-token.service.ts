import jwt from "jsonwebtoken";

import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type { AuthUser } from "../../types/auth";
import type { RefreshTokenInput } from "../schemas/refresh-token.schema";
import { hashRefreshToken } from "../utils/refreshTokenHash";
import {
  generateAccessToken,
  generateRefreshToken,
} from "../utils/jwt";

const REFRESH_TOKEN_EXPIRES_IN_DAYS = 7;

export const refreshAccessToken = async (
  input: RefreshTokenInput,
) => {
  let payload: jwt.JwtPayload;

  try {
    payload = jwt.verify(
      input.refreshToken,
      env.jwtRefreshSecret,
    ) as jwt.JwtPayload;
  } catch {
    throw new AppError(
      "Invalid refresh token",
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }

  if (
    payload.tokenType !== "refresh" ||
    typeof payload.sub !== "string"
  ) {
    throw new AppError(
      "Invalid refresh token",
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }

  const tokenHash = hashRefreshToken(input.refreshToken);

  const storedToken = await prisma.refreshToken.findFirst({
    where: {
      tokenHash,
      userId: payload.sub,
    },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      revokedAt: true,
      user: {
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          emailVerifiedAt: true,
        },
      },
    },
  });

  if (!storedToken) {
    throw new AppError(
      "Invalid refresh token",
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }

  if (storedToken.revokedAt) {
    throw new AppError(
      "Refresh token has been revoked",
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }

  if (storedToken.expiresAt <= new Date()) {
    throw new AppError(
      "Refresh token has expired",
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }

  if (
    !storedToken.user.emailVerifiedAt ||
    storedToken.user.status !== "ACTIVE"
  ) {
    throw new AppError(
      "Account is not active",
      403,
      ErrorCode.FORBIDDEN,
    );
  }

  const authUser: AuthUser = {
    id: storedToken.user.id,
    email: storedToken.user.email,
    role: storedToken.user.role,
    status: storedToken.user.status,
  };

  const newAccessToken = generateAccessToken(authUser);
  const newRefreshToken = generateRefreshToken(authUser);
  const newRefreshTokenHash = hashRefreshToken(newRefreshToken);

  const newExpiresAt = new Date(
    Date.now() +
      REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000,
  );

  const result = await prisma.$transaction(async (tx) => {
    await tx.refreshToken.update({
      where: {
        id: storedToken.id,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    await tx.refreshToken.create({
      data: {
        userId: storedToken.userId,
        tokenHash: newRefreshTokenHash,
        expiresAt: newExpiresAt,
      },
    });

    return {
      user: authUser,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  });

  return result;
};