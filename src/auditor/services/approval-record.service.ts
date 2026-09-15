import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type { AuthUser } from "../../types/auth";

import {
  assertAuditorPermission,
  AuditorPermission,
} from "../policies/auditor.policy";

const SAFE_APPROVAL_RECORD_SELECT = {
  id: true,
  requestId: true,
  reviewerId: true,
  decision: true,
  comment: true,
  createdAt: true,

  reviewer: {
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
    },
  },

  request: {
    select: {
      id: true,
      userId: true,
      accountId: true,
      requestedCurrency: true,
      requestedAmount: true,
      purposeCategory: true,
      purposeDescription: true,
      supportingReference: true,
      status: true,
      reviewedBy: true,
      reviewedAt: true,
      reviewNotes: true,
      expiresAt: true,
      createdAt: true,
      updatedAt: true,

      user: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          status: true,
        },
      },

      account: {
        select: {
          id: true,
          accountNumber: true,
          accountType: true,
          status: true,
        },
      },

      requestedCurrencyRef: {
        select: {
          code: true,
          name: true,
          symbol: true,
          decimalPlaces: true,
          isActive: true,
        },
      },
    },
  },
} as const;

type ApprovalRecordFilters = {
  decision?: string;
  reviewerId?: string;
  requestId?: string;
};

const buildApprovalRecordWhere = (
  filters: ApprovalRecordFilters,
) => {
  return {
    ...(filters.decision !== undefined && {
      decision: filters.decision as
        | "APPROVED"
        | "REJECTED"
        | "NEEDS_MORE_INFORMATION",
    }),

    ...(filters.reviewerId !== undefined && {
      reviewerId: filters.reviewerId,
    }),

    ...(filters.requestId !== undefined && {
      requestId: filters.requestId,
    }),
  };
};

export const getAuditorApprovalRecords = async (
  user: AuthUser,
  page: number,
  limit: number,
  filters: ApprovalRecordFilters = {},
) => {
  assertAuditorPermission(
    user,
    AuditorPermission.APPROVAL_RECORD_VIEW,
  );

  const skip = (page - 1) * limit;

  const where = buildApprovalRecordWhere(filters);

  const [approvalRecords, total] =
    await prisma.$transaction([
      prisma.approvalRecord.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          createdAt: "desc",
        },
        select: SAFE_APPROVAL_RECORD_SELECT,
      }),

      prisma.approvalRecord.count({
        where,
      }),
    ]);

  return {
    approvalRecords,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const getAuditorApprovalRecordById = async (
  user: AuthUser,
  approvalRecordId: string,
) => {
  assertAuditorPermission(
    user,
    AuditorPermission.APPROVAL_RECORD_VIEW,
  );

  const approvalRecord =
    await prisma.approvalRecord.findUnique({
      where: {
        id: approvalRecordId,
      },
      select: SAFE_APPROVAL_RECORD_SELECT,
    });

  if (!approvalRecord) {
    throw new AppError(
      "Approval record not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }

  return approvalRecord;
};