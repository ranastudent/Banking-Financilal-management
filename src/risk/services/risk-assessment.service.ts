import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type { TransferInput } from "../../transaction/schemas/transfer.schema";
import { recordTransferVelocity } from "./velocity.service";
import { riskEngine } from "../risk.engine";

export const assessTransferRisk = async (input: {
  userId: string;
  senderAccountId: string;
  receiverAccountId: string;
  receiverAccountNumber: string;
  transfer: TransferInput;
}) => {
  const { userId, senderAccountId, receiverAccountId, receiverAccountNumber, transfer } = input;
  try {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const [beneficiary, failedAttempts, recentTransfers, velocity] = await Promise.all([
      prisma.beneficiary.findFirst({
        where: { userId, accountReference: receiverAccountNumber, status: "ACTIVE" },
        select: { id: true },
      }),
      prisma.transaction.count({
        where: { sourceAccountId: senderAccountId, type: "INTERNAL_TRANSFER", status: "FAILED", createdAt: { gte: hourAgo } },
      }),
      prisma.transaction.aggregate({
        where: { sourceAccountId: senderAccountId, type: "INTERNAL_TRANSFER", status: "COMPLETED", createdAt: { gte: hourAgo } },
        _avg: { amount: true },
      }),
      recordTransferVelocity(userId, senderAccountId),
    ]);

    const amount = Number(transfer.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new AppError("Invalid transfer amount for risk assessment", 400, ErrorCode.BAD_REQUEST);
    }

    const localHour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: env.transactionLimits.timeZone,
        hour: "2-digit",
        hourCycle: "h23",
      }).formatToParts(now).find((part) => part.type === "hour")?.value ?? now.getUTCHours(),
    );

    return riskEngine.assess({
      userId,
      senderAccountId,
      receiverAccountId,
      receiverAccountNumber,
      amount,
      currency: transfer.currency,
      isNewBeneficiary: !beneficiary,
      failedAttemptsLastHour: failedAttempts,
      transfersLastHour: velocity.transfersLastHour,
      transfersLastMinute: velocity.transfersLastMinute,
      averageCompletedTransferAmount: recentTransfers._avg.amount ? Number(recentTransfers._avg.amount) : null,
      hourOfDay: localHour,
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("[risk] assessment dependency failed", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new AppError(
      "Risk assessment is temporarily unavailable. Please retry later.",
      503,
      ErrorCode.INTERNAL_SERVER_ERROR,
    );
  }
};
