import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import { Prisma } from "@prisma/client";
import type { ApprovalDecisionInput } from "../schemas/approval.schema";

const SAFE_FX_APPROVAL_REQUEST_SELECT = {
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

  approvalRecords: {
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
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
        },
      },
    },
  },
} as const;

export const getAdminApprovalRequests = async (
  page: number,
  limit: number,
) => {
  const skip = (page - 1) * limit;

  const [requests, total] = await prisma.$transaction([
    prisma.foreignCurrencyRequest.findMany({
      where: {
        status: "PENDING",
      },
      skip,
      take: limit,
      orderBy: {
        createdAt: "asc",
      },
      select: SAFE_FX_APPROVAL_REQUEST_SELECT,
    }),

    prisma.foreignCurrencyRequest.count({
      where: {
        status: "PENDING",
      },
    }),
  ]);

  return {
    requests,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const getAdminApprovalRequestById = async (
  requestId: string,
) => {
  const request = await prisma.foreignCurrencyRequest.findUnique({
    where: {
      id: requestId,
    },
    select: SAFE_FX_APPROVAL_REQUEST_SELECT,
  });

  if (!request) {
    throw new AppError(
      "Foreign currency request not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }

  return request;
};

export const decideAdminApprovalRequest = async (
  requestId: string,
  input: ApprovalDecisionInput,
  adminUserId: string,
  ipAddress?: string,
  userAgent?: string,
) => {
  return prisma.$transaction(async (tx) => {
    const requests = await tx.$queryRaw<
      Array<{
        id: string;
        user_id: string;
        account_id: string;
        requested_currency: string;
        requested_amount: Prisma.Decimal;
        status:
          | "PENDING"
          | "APPROVED"
          | "REJECTED"
          | "NEEDS_MORE_INFORMATION"
          | "EXPIRED"
          | "CANCELLED";
      }>
    >`
      SELECT
        id,
        user_id,
        account_id,
        requested_currency,
        requested_amount,
        status
      FROM foreign_currency_requests
      WHERE id = ${requestId}
      FOR UPDATE
    `;

    const requestData = requests[0];

    if (!requestData) {
      throw new AppError(
        "Foreign currency request not found",
        404,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    if (requestData.status !== "PENDING") {
      throw new AppError(
        `Cannot make an approval decision for a request with status ${requestData.status}`,
        409,
        ErrorCode.CONFLICT,
      );
    }

    const nextStatus =
      input.decision === "APPROVED"
        ? "APPROVED"
        : input.decision === "REJECTED"
          ? "REJECTED"
          : "NEEDS_MORE_INFORMATION";

    const updatedRequest =
      await tx.foreignCurrencyRequest.update({
        where: {
          id: requestId,
        },
        data: {
          status: nextStatus,
          reviewedBy: adminUserId,
          reviewedAt: new Date(),
          reviewNotes: input.comment,
        },
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
        },
      });

    await tx.approvalRecord.create({
      data: {
        requestId,
        reviewerId: adminUserId,
        decision: input.decision,
        comment: input.comment,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: adminUserId,
        action: "FX_REQUEST_APPROVAL_DECISION",
        entityType: "FOREIGN_CURRENCY_REQUEST",
        entityId: requestId,
        description: `Foreign currency request ${requestId} received decision ${input.decision}.`,
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
        metadata: {
          decision: input.decision,
          requestStatusBefore: requestData.status,
          requestStatusAfter: nextStatus,
          requestedCurrency: requestData.requested_currency,
          requestedAmount:
            requestData.requested_amount.toString(),
          comment: input.comment,
        },
      },
    });

    return updatedRequest;
  });
};