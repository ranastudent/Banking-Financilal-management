import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { sendEmail } from "../utils/mailer";
import { env } from "../config/env";
import { enqueueEmailRecipientJobs } from "./queues";
import type { NotificationEventPayload, ReportJobPayload, TransferCommittedPayload } from "./types";

const getTransfer = async (transactionId: string) => {
  const transaction = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: {
      sourceAccount: {
        include: { user: true },
      },
      destinationAccount: {
        include: { user: true },
      },
    },
  });

  if (!transaction) {
    throw new Error(`Transaction ${transactionId} was not found`);
  }

  return transaction;
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => {
    const replacements: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return replacements[character] ?? character;
  });

export const handleSendEmail = async (
  payload: TransferCommittedPayload,
): Promise<void> => {
  const transaction = await getTransfer(payload.transactionId);
  const recipientMap = new Map<
    string,
    NonNullable<typeof transaction.sourceAccount>["user"]
  >();

  const candidateUsers = [
    transaction.sourceAccount?.user,
    transaction.destinationAccount?.user,
  ];

  for (const user of candidateUsers) {
    if (user) recipientMap.set(user.email, user);
  }

  if (!payload.recipientUserId) {
    // Fan out into independent recipient jobs. If recipient B fails, recipient
    // A's completed job is not re-run when the dispatcher retries.
    await enqueueEmailRecipientJobs(payload, [...recipientMap.values()].map((user) => user.id));
    return;
  }

  const user = [...recipientMap.values()].find((candidate) => candidate.id === payload.recipientUserId);
  if (!user) {
    throw new Error(`Email recipient ${payload.recipientUserId} is not associated with transfer ${transaction.id}`);
  }

  const amount = transaction.amount.toString();
  const reference = escapeHtml(transaction.reference);
  const currency = escapeHtml(transaction.currencyCode);
  const safeAmount = escapeHtml(amount);
  await sendEmail({
    to: user.email,
    subject: `Transfer confirmation ${transaction.reference}`,
    html: `
      <div>
        <h2>Transfer confirmation</h2>
        <p>Hello ${escapeHtml(user.name)},</p>
        <p>A transfer has been completed on your Banking Platform account.</p>
        <p><strong>Reference:</strong> ${reference}</p>
        <p><strong>Amount:</strong> ${safeAmount} ${currency}</p>
        <p>If you do not recognize this transaction, contact support.</p>
      </div>
    `,
  });
};

export const handleSendNotification = async (
  payload: TransferCommittedPayload,
): Promise<void> => {
  const transaction = await getTransfer(payload.transactionId);
  const amount = transaction.amount.toString();

  const users = [
    {
      userId: transaction.sourceAccount?.userId,
      role: "sender",
    },
    {
      userId: transaction.destinationAccount?.userId,
      role: "receiver",
    },
  ].filter(
    (item, index, all): item is { userId: string; role: string } =>
      Boolean(item.userId) &&
      all.findIndex((candidate) => candidate.userId === item.userId) === index,
  );

  for (const item of users) {
    const isSender = item.role === "sender";
    const message = isSender
      ? `Your transfer of ${amount} ${transaction.currencyCode} was completed. Reference: ${transaction.reference}.`
      : `You received a transfer of ${amount} ${transaction.currencyCode}. Reference: ${transaction.reference}.`;

    await prisma.notification.upsert({
      where: {
        dedupeKey: `${payload.outboxEventId}-${item.userId}`,
      },
      create: {
        userId: item.userId,
        type: "TRANSFER_SUCCESS" as never,
        title: "Transfer completed",
        message,
        channel: "IN_APP",
        status: "SENT",
        dedupeKey: `${payload.outboxEventId}-${item.userId}`,
        metadata: {
          transactionId: transaction.id,
          reference: transaction.reference,
          amount,
          currencyCode: transaction.currencyCode,
          outboxEventId: payload.outboxEventId,
        },
      },
      update: {},
    });
  }
};

export const handleSendNotificationEvent = async (
  payload: NotificationEventPayload,
): Promise<void> => {
  if (!payload.userId || !payload.outboxEventId) {
    throw new Error("Notification event is missing its user or outbox event ID");
  }

  await prisma.notification.upsert({
    where: {
      dedupeKey: `${payload.outboxEventId}-${payload.userId}`,
    },
    create: {
      userId: payload.userId,
      // Prisma Client must be regenerated after adding the new enum values
      // to schema.prisma. The cast keeps source compatibility with older
      // generated clients during the staged migration.
      type: payload.notificationType as never,
      title: payload.title,
      message: payload.message,
      channel: "IN_APP",
      status: "SENT",
      dedupeKey: `${payload.outboxEventId}-${payload.userId}`,
      metadata: {
        ...(payload.metadata ?? {}),
        outboxEventId: payload.outboxEventId,
        notificationType: payload.notificationType,
      },
    },
    update: {},
  });
};

export const handleProcessAuditEvent = async (
  payload: TransferCommittedPayload,
): Promise<void> => {
  const audit = await prisma.auditLog.findFirst({
    where: {
      action: "TRANSFER_CREATED",
      entityType: "TRANSACTION",
      entityId: payload.transactionId,
    },
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      createdAt: true,
    },
  });

  if (!audit) {
    throw new Error(
      `Durable transfer audit log missing for transaction ${payload.transactionId}`,
    );
  }

  // The canonical audit record was committed synchronously with the transfer.
  // This worker is an asynchronous downstream hook and does not replace it.
  console.info("[background-audit-event]", {
    auditLogId: audit.id,
    action: audit.action,
    entityType: audit.entityType,
    entityId: audit.entityId,
    outboxEventId: payload.outboxEventId,
    processedAt: new Date().toISOString(),
  });
};

export const handleRiskAnalysis = async (
  payload: TransferCommittedPayload,
): Promise<void> => {
  const transaction = await getTransfer(payload.transactionId);
  const windowStart = new Date(
    Date.now() - env.backgroundJobs.riskAnalysis.windowMinutes * 60_000,
  );

  let recentTransferCount = 0;
  if (transaction.sourceAccountId) {
    recentTransferCount = await prisma.transaction.count({
      where: {
        sourceAccountId: transaction.sourceAccountId,
        type: "INTERNAL_TRANSFER",
        status: "COMPLETED",
        createdAt: { gte: windowStart },
      },
    });
  }

  const isReview = recentTransferCount >=
    env.backgroundJobs.riskAnalysis.maxTransfersPerWindow;

  const reasons = isReview
    ? [
        `Source account reached ${recentTransferCount} internal transfers within the configured ${env.backgroundJobs.riskAnalysis.windowMinutes}-minute window.`,
      ]
    : [];

  await prisma.riskAnalysis.upsert({
    where: { transactionId: transaction.id },
    create: {
      transactionId: transaction.id,
      riskLevel: isReview ? "REVIEW" : "NORMAL",
      reasons,
      analyzedAt: new Date(),
    },
    update: {
      riskLevel: isReview ? "REVIEW" : "NORMAL",
      reasons,
      analyzedAt: new Date(),
    },
  });

  if (isReview) {
    console.warn("[background-risk-analysis] transfer flagged for review", {
      transactionId: transaction.id,
      reference: transaction.reference,
      riskLevel: "REVIEW",
      recentTransferCount,
      windowMinutes: env.backgroundJobs.riskAnalysis.windowMinutes,
    });
  }
};

const utcDayBounds = (date: Date): { start: Date; end: Date } => {
  const start = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  ));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
};

export const handleGenerateReport = async (
  payload: ReportJobPayload,
  scheduledAt?: number,
): Promise<void> => {
  let periodStart: Date;
  let periodEnd: Date;

  if (payload.periodStart || payload.periodEnd) {
    if (!payload.periodStart || !payload.periodEnd) {
      throw new Error("Both report periodStart and periodEnd are required");
    }
    periodStart = new Date(payload.periodStart);
    periodEnd = new Date(payload.periodEnd);
    if (
      Number.isNaN(periodStart.getTime()) ||
      Number.isNaN(periodEnd.getTime()) ||
      periodStart >= periodEnd
    ) {
      throw new Error("Invalid report period");
    }
  } else {
    // Repeatable BullMQ jobs carry the scheduled occurrence timestamp. Use it
    // rather than actual execution time so delayed/retried jobs report the day
    // they were scheduled to cover, not the most recent day.
    const referenceDate = payload.trigger === "scheduled" && Number.isFinite(scheduledAt)
      ? new Date(scheduledAt as number)
      : new Date();
    const previousUtcDay = new Date(referenceDate);
    previousUtcDay.setUTCDate(previousUtcDay.getUTCDate() - 1);
    ({ start: periodStart, end: periodEnd } = utcDayBounds(previousUtcDay));
  }

  const grouped = await prisma.transaction.groupBy({
    by: ["currencyCode", "status"],
    where: {
      createdAt: {
        gte: periodStart,
        lt: periodEnd,
      },
    },
    _count: { _all: true },
    _sum: { amount: true },
  });

  const payloadJson: Prisma.InputJsonValue = {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    groups: grouped.map((group) => ({
      currencyCode: group.currencyCode,
      status: group.status,
      transactionCount: group._count._all,
      totalAmount: group._sum.amount?.toString() ?? "0",
    })),
  };

  const dedupeKey = `daily-transaction-report-${periodStart.toISOString()}`;
  await prisma.backgroundReport.upsert({
    where: { dedupeKey },
    create: {
      reportType: "DAILY_TRANSACTION_SUMMARY",
      dedupeKey,
      periodStart,
      periodEnd,
      payload: payloadJson,
      generatedAt: new Date(),
    },
    update: {
      periodEnd,
      payload: payloadJson,
      generatedAt: new Date(),
    },
  });

  console.info("[background-report] generated", {
    reportType: "DAILY_TRANSACTION_SUMMARY",
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    groups: grouped.length,
  });
};
