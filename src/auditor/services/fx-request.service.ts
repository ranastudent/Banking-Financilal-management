import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type { AuthUser } from "../../types/auth";

import {
  assertAuditorPermission,
  AuditorPermission,
} from "../policies/auditor.policy";

const SAFE_AUDITOR_FX_REQUEST_SELECT = {
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
      emailVerifiedAt: true,
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

  reviewer: {
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
    },
  },

  approvalRecords: {
    select: {
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
    },

    orderBy: {
      createdAt: "desc" as const,
    },
  },
} as const;

type FxRequestFilters = {
  status?: string;
  userId?: string;
  accountId?: string;
  requestedCurrency?: string;
};

const buildFxRequestWhere = (
  filters: FxRequestFilters,
) => {
  return {
    ...(filters.status !== undefined && {
      status: filters.status as
        | "PENDING"
        | "APPROVED"
        | "REJECTED"
        | "NEEDS_MORE_INFORMATION"
        | "EXPIRED"
        | "CANCELLED",
    }),

    ...(filters.userId !== undefined && {
      userId: filters.userId,
    }),

    ...(filters.accountId !== undefined && {
      accountId: filters.accountId,
    }),

    ...(filters.requestedCurrency !== undefined && {
      requestedCurrency: filters.requestedCurrency,
    }),
  };
};

export const getAuditorFxRequests = async (
  user: AuthUser,
  page: number,
  limit: number,
  filters: FxRequestFilters = {},
) => {
  assertAuditorPermission(
    user,
    AuditorPermission.FX_REQUEST_HISTORY_VIEW,
  );

  const skip = (page - 1) * limit;

  const where = buildFxRequestWhere(filters);

  const [fxRequests, total] =
    await prisma.$transaction([
      prisma.foreignCurrencyRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          createdAt: "desc",
        },
        select: SAFE_AUDITOR_FX_REQUEST_SELECT,
      }),

      prisma.foreignCurrencyRequest.count({
        where,
      }),
    ]);

  return {
    fxRequests,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const getAuditorFxRequestById = async (
  user: AuthUser,
  requestId: string,
) => {
  assertAuditorPermission(
    user,
    AuditorPermission.FX_REQUEST_HISTORY_VIEW,
  );

  const fxRequest =
    await prisma.foreignCurrencyRequest.findUnique({
      where: {
        id: requestId,
      },
      select: SAFE_AUDITOR_FX_REQUEST_SELECT,
    });

  if (!fxRequest) {
    throw new AppError(
      "FX request not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }

  return fxRequest;
};