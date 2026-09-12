import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";

export const getCustomerOwnedFxRequest = async (
  requestId: string,
  userId: string,
) => {
  const request = await prisma.foreignCurrencyRequest.findUnique({
    where: {
      id: requestId,
    },
  });

  if (!request) {
    throw new AppError(
      "FX request not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }

  if (request.userId !== userId) {
    throw new AppError(
      "You do not have permission to access this FX request",
      403,
      ErrorCode.FORBIDDEN,
    );
  }

  return request;
};