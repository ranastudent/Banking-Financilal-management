import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type { RefreshTokenInput } from "../schemas/refresh-token.schema";
import { hashRefreshToken } from "../utils/refreshTokenHash";

export const logoutUser = async (
  input: RefreshTokenInput,
): Promise<void> => {
  const tokenHash = hashRefreshToken(input.refreshToken);

  const result = await prisma.refreshToken.updateMany({
    where: {
      tokenHash,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });

  if (result.count === 0) {
    throw new AppError(
      "Invalid or already revoked refresh token",
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }
};