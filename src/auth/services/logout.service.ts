import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type { RefreshTokenInput } from "../schemas/refresh-token.schema";
import { prisma } from "../../config/prisma";
import { writeAuditLog } from "../../audit/audit.service";
import type { AuditContext } from "../../audit/audit.types";
import { hashRefreshToken } from "../utils/refreshTokenHash";

export const logoutUser = async (
  input: RefreshTokenInput,
  auditContext: AuditContext = {},
): Promise<void> => {
  const tokenHash = hashRefreshToken(input.refreshToken);

  const revoked = await prisma.$transaction(async (tx) => {
    const storedToken = await tx.refreshToken.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
      },
      select: {
        id: true,
        userId: true,
      },
    });

    if (!storedToken) {
      return false;
    }

    const updateResult = await tx.refreshToken.updateMany({
      where: {
        id: storedToken.id,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    if (updateResult.count !== 1) {
      return false;
    }

    await writeAuditLog(
      {
        userId: storedToken.userId,
        action: "LOGOUT",
        resource: "USER",
        resourceId: storedToken.userId,
        description: "User logged out successfully.",
        ...auditContext,
        metadata: { refreshTokenRevoked: true },
      },
      tx,
    );

    return true;
  });

  if (!revoked) {
    throw new AppError(
      "Invalid or already revoked refresh token",
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }
};