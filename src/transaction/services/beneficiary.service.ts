import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import { getCustomerOwnedBeneficiary } from "../policies/beneficiary.policy";

export const authorizeBeneficiaryView = async (
  beneficiaryId: string,
  userId: string,
  userRole: string,
) => {
  if (userRole === "CUSTOMER") {
    return getCustomerOwnedBeneficiary(beneficiaryId, userId);
  }

  if (
    userRole === "ADMIN" ||
    userRole === "SUPPORT" ||
    userRole === "AUDITOR"
  ) {
    const beneficiary = await prisma.beneficiary.findUnique({
      where: {
        id: beneficiaryId,
      },
    });

    if (!beneficiary) {
      throw new AppError(
        "Beneficiary not found",
        404,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return beneficiary;
  }

  throw new AppError(
    "You do not have permission to view this beneficiary",
    403,
    ErrorCode.FORBIDDEN,
  );
};