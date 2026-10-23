import { prisma } from "../../config/prisma";
import { writeAuditLog } from "../../audit/audit.service";
import type { AuditContext } from "../../audit/audit.types";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type { AuthUser } from "../../types/auth";
import { getCustomerOwnedBeneficiary } from "../policies/beneficiary.policy";
import type {
  CreateBeneficiaryInput,
  ListBeneficiariesQuery,
  UpdateBeneficiaryInput,
} from "../schemas/beneficiary.schema";

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

const assertActiveCurrency = async (
  currencyCode: string,
): Promise<void> => {
  const currency = await prisma.currency.findFirst({
    where: {
      code: currencyCode,
      isActive: true,
    },
    select: {
      code: true,
    },
  });

  if (!currency) {
    throw new AppError(
      "Currency not found or inactive",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }
};

export const createBeneficiary = async (
  user: AuthUser,
  input: CreateBeneficiaryInput,
  auditContext: AuditContext = {},
) => {
  await assertActiveCurrency(input.currencyCode);

  return prisma.$transaction(async (tx) => {
    const beneficiary = await tx.beneficiary.create({
      data: {
        userId: user.id,
        beneficiaryType: input.beneficiaryType,
        displayName: input.displayName,
        accountReference: input.accountReference,
        provider: input.provider ?? null,
        currencyCode: input.currencyCode,
      },
      select: SAFE_BENEFICIARY_SELECT,
    });

    await writeAuditLog(
      {
        userId: user.id,
        action: "BENEFICIARY_ADDED",
        resource: "BENEFICIARY",
        resourceId: beneficiary.id,
        description: "Beneficiary added.",
        ...auditContext,
        metadata: {
          beneficiaryType: beneficiary.beneficiaryType,
          currencyCode: beneficiary.currencyCode,
          provider: beneficiary.provider,
        },
      },
      tx,
    );

    return beneficiary;
  });
};

export const listBeneficiaries = async (
  userId: string,
  query: ListBeneficiariesQuery,
) => {
  const where = { userId };
  const skip = (query.page - 1) * query.limit;

  const [beneficiaries, total] = await prisma.$transaction([
    prisma.beneficiary.findMany({
      where,
      select: SAFE_BENEFICIARY_SELECT,
      orderBy: [
        { createdAt: "desc" },
        { id: "desc" },
      ],
      skip,
      take: query.limit,
    }),
    prisma.beneficiary.count({
      where,
    }),
  ]);

  return {
    beneficiaries,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
};

export const updateBeneficiary = async (
  userId: string,
  beneficiaryId: string,
  input: UpdateBeneficiaryInput,
  auditContext: AuditContext = {},
) => {
  if (input.currencyCode !== undefined) {
    await assertActiveCurrency(input.currencyCode);
  }

  const data = {
    ...(input.displayName !== undefined && {
      displayName: input.displayName,
    }),
    ...(input.accountReference !== undefined && {
      accountReference: input.accountReference,
    }),
    ...(input.provider !== undefined && {
      provider: input.provider,
    }),
    ...(input.currencyCode !== undefined && {
      currencyCode: input.currencyCode,
    }),
  };

  return prisma.$transaction(async (tx) => {
    const existing = await tx.beneficiary.findFirst({
      where: {
        id: beneficiaryId,
        userId,
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      throw new AppError(
        "Beneficiary not found",
        404,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    const beneficiary = await tx.beneficiary.update({
      where: {
        id: beneficiaryId,
      },
      data,
      select: SAFE_BENEFICIARY_SELECT,
    });

    await writeAuditLog(
      {
        userId,
        action: "BENEFICIARY_UPDATED",
        resource: "BENEFICIARY",
        resourceId: beneficiary.id,
        description: "Beneficiary details updated.",
        ...auditContext,
        metadata: {
          changedFields: Object.keys(data),
        },
      },
      tx,
    );

    return beneficiary;
  });
};

export const deleteBeneficiary = async (
  userId: string,
  beneficiaryId: string,
  auditContext: AuditContext = {},
): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const beneficiary = await tx.beneficiary.findFirst({
      where: {
        id: beneficiaryId,
        userId,
      },
      select: {
        id: true,
      },
    });

    if (!beneficiary) {
      throw new AppError(
        "Beneficiary not found",
        404,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    await tx.beneficiary.delete({
      where: {
        id: beneficiaryId,
      },
    });

    await writeAuditLog(
      {
        userId,
        action: "BENEFICIARY_DELETED",
        resource: "BENEFICIARY",
        resourceId: beneficiaryId,
        description: "Beneficiary deleted.",
        ...auditContext,
      },
      tx,
    );
  });
};

/**
 * Authorizes access to a single beneficiary.
 * CUSTOMER access is ownership-scoped.
 * ADMIN and AUDITOR retain the existing privileged read behavior.
 */
export const authorizeBeneficiaryView = async (
  beneficiaryId: string,
  userId: string,
  userRole: string,
) => {
  if (userRole === "CUSTOMER") {
    return getCustomerOwnedBeneficiary(
      beneficiaryId,
      userId,
    );
  }

  if (userRole === "ADMIN" || userRole === "AUDITOR") {
    const beneficiary = await prisma.beneficiary.findUnique({
      where: {
        id: beneficiaryId,
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
  }

  throw new AppError(
    "You do not have permission to view this beneficiary",
    403,
    ErrorCode.FORBIDDEN,
  );
};