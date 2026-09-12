import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import { getCustomerOwnedFxRequest } from "../policies/fx-request.policy";

export const authorizeFxRequestView = async (
  requestId: string,
  userId: string,
  userRole: string,
) => {
  if (userRole === "CUSTOMER") {
    return getCustomerOwnedFxRequest(requestId, userId);
  }

  if (
    userRole === "ADMIN" ||
    userRole === "SUPPORT" ||
    userRole === "AUDITOR"
  ) {
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

    return request;
  }

  throw new AppError(
    "You do not have permission to view this FX request",
    403,
    ErrorCode.FORBIDDEN,
  );
};