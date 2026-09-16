import { prisma } from "../../config/prisma";
import { hashRefreshToken } from "../utils/refreshTokenHash";

export const revokeRefreshToken = async (
  refreshToken: string,
): Promise<boolean> => {
  const tokenHash = hashRefreshToken(refreshToken);

  const result = await prisma.refreshToken.updateMany({
    where: {
      tokenHash,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });

  return result.count === 1;
};

export const revokeAllRefreshTokensForUser = async (
  userId: string,
): Promise<number> => {
  const result = await prisma.refreshToken.updateMany({
    where: {
      userId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });

  return result.count;
};