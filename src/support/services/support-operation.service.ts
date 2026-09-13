import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type { AuthUser } from "../../types/auth";
import {
  assertSupportPermission,
  SupportPermission,
} from "../policies/support.policy";

type SupportOperationType =
  | "ACCOUNT_INQUIRY"
  | "TRANSACTION_INQUIRY"
  | "BENEFICIARY_ASSISTANCE"
  | "GENERAL_SUPPORT";

export const recordCustomerSupportOperation = async (
  user: AuthUser,
  customerId: string,
  operationType: SupportOperationType,
  description: string,
  ipAddress: string | null,
  userAgent: string | null,
) => {
  assertSupportPermission(
    user,
    SupportPermission.CUSTOMER_SUPPORT_OPERATION,
  );

  return prisma.$transaction(async (tx) => {
    /*
     * Only CUSTOMER records may be targeted by this
     * support operation.
     *
     * Nonexistent users and non-customer users both
     * return the same response.
     */
    const customer = await tx.user.findFirst({
      where: {
        id: customerId,
        role: "CUSTOMER",
      },
      select: {
        id: true,
        name: true,
        email: true,
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
     * This operation does NOT modify the customer.
     *
     * It records the support action in the audit trail.
     */
    const auditLog = await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "SUPPORT_CUSTOMER_OPERATION",
        entityType: "CUSTOMER",
        entityId: customer.id,
        description,
        ipAddress,
        userAgent,
        metadata: {
          operationType,
          customerId: customer.id,
        },
      },
      select: {
        id: true,
        userId: true,
        action: true,
        entityType: true,
        entityId: true,
        description: true,
        ipAddress: true,
        userAgent: true,
        metadata: true,
        createdAt: true,
      },
    });

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
      },
      supportOperation: auditLog,
    };
  });
};