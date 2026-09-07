import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type { AuthUser } from "../../types/auth";
import type { LoginInput } from "../schemas/auth.schema";
import { comparePassword } from "../utils/password";
import {
  generateAccessToken,
  generateRefreshToken,
} from "../utils/jwt";
import { hashRefreshToken } from "../utils/refreshTokenHash";

const INVALID_CREDENTIALS_MESSAGE = "Invalid email or password";

const REFRESH_TOKEN_EXPIRES_IN_DAYS = 7;

export const loginUser = async (input: LoginInput) => {
  const email = input.email.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: {
      email,
    },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      role: true,
      status: true,
      emailVerifiedAt: true,
    },
  });

  if (!user) {
    throw new AppError(
      INVALID_CREDENTIALS_MESSAGE,
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }

  if (!user.emailVerifiedAt) {
    throw new AppError(
      "Please verify your email before logging in",
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }

  if (user.status !== "ACTIVE") {
    throw new AppError(
      "Your account is not active",
      403,
      ErrorCode.FORBIDDEN,
    );
  }

  const passwordMatches = await comparePassword(
    input.password,
    user.passwordHash,
  );

  if (!passwordMatches) {
    throw new AppError(
      INVALID_CREDENTIALS_MESSAGE,
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }

  const authUser: AuthUser = {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
  };

  const accessToken = generateAccessToken(authUser);
  const refreshToken = generateRefreshToken(authUser);

  const refreshTokenHash = hashRefreshToken(refreshToken);

  const expiresAt = new Date(
    Date.now() +
      REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000,
  );

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: refreshTokenHash,
      expiresAt,
    },
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
    },
    accessToken,
    refreshToken,
  };
};