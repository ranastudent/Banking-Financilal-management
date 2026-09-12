import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";

export const getCustomerOwnedBeneficiary = async (
  beneficiaryId: string,
  userId: string,
) => {
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

  if (beneficiary.userId !== userId) {
    throw new AppError(
      "You do not have permission to access this beneficiary",
      403,
      ErrorCode.FORBIDDEN,
    );
  }

  return beneficiary;
};