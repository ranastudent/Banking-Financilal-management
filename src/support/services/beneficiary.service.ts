import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type { AuthUser } from "../../types/auth";
import {
  assertSupportPermission,
  SupportPermission,
} from "../policies/support.policy";

const SAFE_BENEFICIARY_SELECT = {
  id: true,
  userId: true,
  beneficiaryType: true,
  displayName: true,
  accountReference: true,
  provider: true,
  currencyCode: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const getSupportCustomerBeneficiary = async (
  user: AuthUser,
  customerId: string,
  beneficiaryId: string,
) => {
  assertSupportPermission(
    user,
    SupportPermission.BENEFICIARY_ASSISTANCE,
  );

  /*
   * First establish that the target is a CUSTOMER.
   *
   * Nonexistent user and non-customer user both return
   * the same 404 to avoid role enumeration.
   */
  const customer = await prisma.user.findFirst({
    where: {
      id: customerId,
      role: "CUSTOMER",
    },
    select: {
      id: true,
    },
  });

  if (!customer) {
    throw new AppError(
      "Customer not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }

  /*
   * The beneficiary must belong to the requested customer.
   *
   * This is the important resource-ownership boundary.
   */
  const beneficiary =
    await prisma.beneficiary.findFirst({
      where: {
        id: beneficiaryId,
        userId: customer.id,
      },
      select: SAFE_BENEFICIARY_SELECT,
    });

  if (!beneficiary) {
    throw new AppError(
      "Beneficiary not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }

  return beneficiary;
};