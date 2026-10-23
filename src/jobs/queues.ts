import { Queue, type JobsOptions } from "bullmq";
import { env } from "../config/env";
import { createBullMqQueueConnection } from "./connection";
import type {
  BackgroundJobData,
  BackgroundJobName,
  NotificationEventPayload,
  ReportJobPayload,
  TransferCommittedPayload,
} from "./types";

export const BACKGROUND_QUEUE_NAME = "banking-background";

const queueConnection = createBullMqQueueConnection();

export const backgroundQueue = new Queue<
  BackgroundJobData,
  void,
  BackgroundJobName
>(BACKGROUND_QUEUE_NAME, {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});

const transferJobOptions = (
  outboxEventId: string,
  suffix: string,
): JobsOptions => ({
  // BullMQ custom IDs must not contain ":".
  jobId: `${outboxEventId}-${suffix}`,
});

export const enqueueTransferJobs = async (
  payload: TransferCommittedPayload,
): Promise<void> => {
  const jobs: Array<{
    name: BackgroundJobName;
    suffix: string;
  }> = [
    { name: "send-email", suffix: "send-email" },
    { name: "send-notification", suffix: "send-notification" },
    { name: "process-audit-event", suffix: "process-audit-event" },
    { name: "risk-analysis", suffix: "risk-analysis" },
  ];

  // Stable IDs make publishing the same outbox event idempotent while
  // BullMQ retains the corresponding job records.
  for (const job of jobs) {
    await backgroundQueue.add(
      job.name,
      payload,
      transferJobOptions(payload.outboxEventId, job.suffix),
    );
  }
};

/** Enqueue one durable in-app notification job with a stable event-scoped ID. */
export const enqueueNotificationEvent = async (
  payload: NotificationEventPayload,
): Promise<void> => {
  await backgroundQueue.add(
    "send-notification-event",
    payload,
    { jobId: `${payload.outboxEventId}-notification-${payload.userId}` },
  );
};

/** Queue one email job per recipient so a failure for one recipient cannot
 * cause already-completed deliveries to be repeated by retrying the batch. */
export const enqueueEmailRecipientJobs = async (
  payload: TransferCommittedPayload,
  recipientUserIds: string[],
): Promise<void> => {
  for (const recipientUserId of [...new Set(recipientUserIds)]) {
    await backgroundQueue.add(
      "send-email",
      { ...payload, recipientUserId },
      { jobId: `${payload.outboxEventId}-send-email-${recipientUserId}` },
    );
  }
};

export const enqueueReportGeneration = async (
  payload: ReportJobPayload,
): Promise<void> => {
  const periodPart = payload.periodStart && payload.periodEnd
    ? `${payload.periodStart.replace(/[^0-9]/g, "").slice(0, 14)}-${payload.periodEnd.replace(/[^0-9]/g, "").slice(0, 14)}`
    : `previous-day-${new Date().toISOString().slice(0, 10)}`;
  await backgroundQueue.add(
    "generate-report",
    payload,
    {
      jobId: `transaction-report-${periodPart}`,
    },
  );
};

export const scheduleDailyReport = async (): Promise<void> => {
  await backgroundQueue.add(
    "generate-report",
    { trigger: "scheduled" },
    {
      jobId: "daily-transaction-report",
      repeat: {
        pattern: env.backgroundJobs.dailyReportCron,
      },
    },
  );
};

let queueClosed = false;
export const closeBackgroundQueue = async (): Promise<void> => {
  if (queueClosed) return;
  queueClosed = true;
  const errors: unknown[] = [];
  try {
    await backgroundQueue.close();
  } catch (error) {
    errors.push(error);
  }
  try {
    if (queueConnection.status !== "end") await queueConnection.quit();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length) {
    queueClosed = false;
    throw new AggregateError(errors, "Failed to close background queue resources");
  }
};
