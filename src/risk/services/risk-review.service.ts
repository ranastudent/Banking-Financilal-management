import { prisma } from "../../config/prisma";
import { writeAuditLog } from "../../audit/audit.service";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type { AuthUser } from "../../types/auth";
import { prepareTransfer } from "../../transaction/services/transfer.service";
import type { RiskReviewDecisionInput } from "../schemas/risk-review.schema";
import { recordRiskReview } from "../../observability/metrics";

export const listPendingRiskReviews = async (page: number, limit: number) => {
  const where = {
    reviewStatus: "PENDING" as const,
    transaction: { is: { status: "ON_HOLD" as const } },
  };
  const [items, total] = await prisma.$transaction([
    prisma.riskAnalysis.findMany({
      where,
      orderBy: { analyzedAt: "asc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true, transactionId: true, riskScore: true, riskLevel: true,
        decision: true, reviewStatus: true, reasons: true, analyzedAt: true,
        transaction: {
          select: {
            id: true, reference: true, status: true, amount: true, currencyCode: true,
            createdAt: true,
            sourceAccount: { select: { id: true, accountNumber: true, userId: true } },
            destinationAccount: { select: { id: true, accountNumber: true } },
          },
        },
      },
    }),
    prisma.riskAnalysis.count({ where }),
  ]);
  return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
};

export const getRiskReviewById = async (riskAnalysisId: string) => {
  const item = await prisma.riskAnalysis.findUnique({
    where: { id: riskAnalysisId },
    include: {
      transaction: {
        select: {
          id: true, reference: true, status: true, amount: true, currencyCode: true,
          metadata: true, createdAt: true,
          sourceAccount: { select: { id: true, accountNumber: true, userId: true } },
          destinationAccount: { select: { id: true, accountNumber: true } },
        },
      },
      reviews: { orderBy: { createdAt: "desc" }, include: { reviewer: { select: { id: true, name: true, email: true, role: true } } } },
    },
  });
  if (!item) throw new AppError("Risk assessment not found", 404, ErrorCode.RESOURCE_NOT_FOUND);
  return item;
};

export const decideRiskReview = async (
  riskAnalysisId: string,
  input: RiskReviewDecisionInput,
  adminUserId: string,
  requestId?: string,
  ipAddress?: string,
  userAgent?: string,
) => {
  const risk = await prisma.riskAnalysis.findUnique({
    where: { id: riskAnalysisId },
    include: {
      transaction: {
        include: {
          sourceAccount: { include: { user: true } },
          destinationAccount: true,
        },
      },
    },
  });
  if (!risk) throw new AppError("Risk assessment not found", 404, ErrorCode.RESOURCE_NOT_FOUND);
  if (risk.reviewStatus !== "PENDING" || risk.transaction.status !== "ON_HOLD") {
    throw new AppError("This risk assessment is no longer pending review", 409, ErrorCode.CONFLICT);
  }
  const sourceAccount = risk.transaction.sourceAccount;
  const destinationAccount = risk.transaction.destinationAccount;
  if (!sourceAccount || !destinationAccount) {
    throw new AppError("Held transfer account data is incomplete", 409, ErrorCode.CONFLICT);
  }

  if (input.decision === "REJECTED") {
    const rejected = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT status FROM transactions WHERE id = ${risk.transactionId} FOR UPDATE
      `;
      if (!rows[0] || rows[0].status !== "ON_HOLD") {
        throw new AppError("Held transfer is no longer pending review", 409, ErrorCode.CONFLICT);
      }
      await tx.transaction.update({ where: { id: risk.transactionId }, data: { status: "CANCELLED" } });
      await tx.riskAnalysis.update({ where: { id: riskAnalysisId }, data: { reviewStatus: "REJECTED" } });
      const review = await tx.riskReview.create({
        data: {
          riskAnalysisId,
          reviewerId: adminUserId,
          decision: "REJECTED",
          ...(input.comment !== undefined ? { comment: input.comment } : {}),
          ...(requestId !== undefined ? { requestId } : {}),
        },
      });
      await writeAuditLog({
        userId: adminUserId,
        action: "RISK_TRANSFER_REJECTED",
        resource: "TRANSACTION",
        resourceId: risk.transactionId,
        description: `Held transfer ${risk.transaction.reference} was rejected.`,
        requestId, ipAddress, userAgent,
        metadata: { riskAnalysisId, comment: input.comment ?? null },
      }, tx);
      await tx.outboxEvent.create({
        data: { eventType: "NOTIFICATION_REQUESTED", payload: {
          userId: sourceAccount.userId,
          notificationType: "SECURITY_ALERT",
          title: "Transfer rejected",
          message: "Your transfer request was rejected after security review. No money was moved.",
          metadata: { transactionId: risk.transactionId, reference: risk.transaction.reference },
        } },
      });
      return review;
    });
    recordRiskReview("REJECTED");
    return { decision: "REJECTED", review: rejected, transactionId: risk.transactionId };
  }

  // Execute through the same production transfer service. The original held
  // row is locked and transitioned inside that service's financial transaction.
  if (!sourceAccount.user) {
    throw new AppError("Held transfer owner could not be resolved", 409, ErrorCode.CONFLICT);
  }
  const owner = sourceAccount.user;
  const authUser: AuthUser = { id: owner.id, email: owner.email, role: owner.role, status: owner.status };
  const transfer = await prepareTransfer(
    authUser,
    {
      senderAccount: sourceAccount.accountNumber,
      receiverAccount: destinationAccount.accountNumber,
      amount: risk.transaction.amount.toString(),
      currency: risk.transaction.currencyCode,
    },
    undefined,
    { requestId, ipAddress, userAgent },
    {
      heldTransactionId: risk.transactionId,
      reviewerId: adminUserId,
      ...(input.comment !== undefined ? { comment: input.comment } : {}),
    },
  );
  recordRiskReview("APPROVED");
  return { decision: "APPROVED", transaction: transfer.transaction, heldTransactionId: risk.transactionId };
};
