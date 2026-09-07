import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type { RefreshTokenInput } from "../schemas/refresh-token.schema";
import { revokeRefreshToken } from "./token-revocation.service";

export const logoutUser = async (
  input: RefreshTokenInput,
): Promise<void> => {
  const revoked = await revokeRefreshToken(
    input.refreshToken,
  );

  if (!revoked) {
    throw new AppError(
      "Invalid or already revoked refresh token",
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }
};