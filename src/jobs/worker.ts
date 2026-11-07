import { Worker, type Job } from "bullmq";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { createBullMqConnection } from "./connection";
import {
  BACKGROUND_QUEUE_NAME,
  closeBackgroundQueue,
  scheduleDailyReport,
} from "./queues";
import {
  handleGenerateReport,
  handleProcessAuditEvent,
  handleRiskAnalysis,
  handleMonitorTransaction,
  handleProcessMonitoringEvent,
  handleSendEmail,
  handleSendNotification,
  handleSendNotificationEvent,
} from "./handlers";
import type {
  BackgroundJobData,
  BackgroundJobName,
  NotificationEventPayload,
  ReportJobPayload,
  TransferCommittedPayload,
  MonitoringEventJobPayload,
} from "./types";
import { isNotificationEventPayload, isTransferCommittedPayload } from "./types";
import { logger } from "../observability/logger";
import { recordQueueFailure } from "../observability/metrics";
import {
  startOutboxPublisher,
  stopOutboxPublisher,
} from "./outbox-publisher";

let workerConnection: ReturnType<typeof createBullMqConnection> | null = null;
let worker: Worker<BackgroundJobData, void, BackgroundJobName> | null = null;
let scheduledRunTimer: NodeJS.Timeout | null = null;
let shutdownPromise: Promise<void> | null = null;
let shuttingDown = false;

/**
 * Optional bounded-run mode for scheduled environments such as GitHub Actions.
 * When unset, the worker keeps running as a normal long-lived BullMQ worker.
 * Example: WORKER_RUN_DURATION_MS=210000 (3.5 minutes).
 */
const getScheduledRunDurationMs = (): number | null => {
  const raw = process.env.WORKER_RUN_DURATION_MS?.trim();
  if (!raw) return null;

  const durationMs = Number(raw);
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
    throw new Error("WORKER_RUN_DURATION_MS must be a positive integer in milliseconds");
  }

  return durationMs;
};

const createWorker = (): Worker<BackgroundJobData, void, BackgroundJobName> => {
  workerConnection = createBullMqConnection();

  return new Worker<BackgroundJobData, void, BackgroundJobName>(
    BACKGROUND_QUEUE_NAME,
    async (job: Job<BackgroundJobData, void, BackgroundJobName>) => {
      logger.info("background.job.started", {
        jobId: job.id,
        jobName: job.name,
        attemptsMade: job.attemptsMade,
      });

      if (job.name === "generate-report") {
        await handleGenerateReport(job.data as ReportJobPayload, job.timestamp);
      } else if (job.name === "process-monitoring-event") {
        await handleProcessMonitoringEvent(job.data as MonitoringEventJobPayload);
      } else if (job.name === "send-notification-event") {
        if (!isNotificationEventPayload(job.data)) {
          throw new Error(`Invalid notification-event payload for job ${job.name}`);
        }
        await handleSendNotificationEvent(job.data as NotificationEventPayload);
      } else {
        if (!isTransferCommittedPayload(job.data)) {
          throw new Error(`Invalid payload for job ${job.name}`);
        }

        const payload = job.data as TransferCommittedPayload;
        switch (job.name) {
          case "send-email":
            await handleSendEmail(payload);
            break;
          case "send-notification":
            await handleSendNotification(payload);
            break;
          case "process-audit-event":
            await handleProcessAuditEvent(payload);
            break;
          case "risk-analysis":
            await handleRiskAnalysis(payload);
            break;
          case "monitor-transaction":
            await handleMonitorTransaction(payload);
            break;
          default: {
            const exhaustive: never = job.name;
            throw new Error(`Unsupported background job: ${exhaustive}`);
          }
        }
      }

      logger.info("background.job.completed", {
        jobId: job.id,
        jobName: job.name,
      });
    },
    { connection: workerConnection, concurrency: 5 },
  );
};

const shutdownWorker = (signal: string): Promise<void> => {
  if (shutdownPromise) return shutdownPromise;

  shuttingDown = true;
  if (scheduledRunTimer) {
    clearTimeout(scheduledRunTimer);
    scheduledRunTimer = null;
  }

  shutdownPromise = (async () => {
    logger.info("background.worker.shutdown_started", { signal });
    const errors: unknown[] = [];

    const cleanup = async (
      label: string,
      action: () => Promise<unknown>,
    ): Promise<void> => {
      try {
        await action();
      } catch (error) {
        errors.push(error);
        logger.error("background.worker.cleanup_failed", {
          component: label,
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage:
            process.env.NODE_ENV === "production" || !(error instanceof Error)
              ? undefined
              : error.message,
        });
      }
    };

    // Stop producing jobs before closing the consumer. This prevents the
    // publisher from enqueueing new work while the worker is shutting down.
    await cleanup("outbox-publisher", stopOutboxPublisher);

    if (worker) {
      await cleanup("worker", () => worker!.close());
    }

    if (workerConnection && workerConnection.status !== "end") {
      await cleanup("worker-redis", () => workerConnection!.quit());
    }

    await cleanup("queue", closeBackgroundQueue);
    await cleanup("prisma", () => prisma.$disconnect());

    if (errors.length > 0) {
      logger.error("background.worker.shutdown_completed_with_errors", {
        errorCount: errors.length,
      });
      process.exitCode = 1;
    } else {
      logger.info("background.worker.shutdown_completed");
    }
  })();

  return shutdownPromise;
};

process.once("SIGTERM", () => {
  void shutdownWorker("SIGTERM");
});

process.once("SIGINT", () => {
  void shutdownWorker("SIGINT");
});

const start = async (): Promise<void> => {
  const scheduledRunDurationMs = getScheduledRunDurationMs();

  // Do not construct the Worker until Prisma is connected: BullMQ may start
  // consuming as soon as the Worker instance is created.
  await prisma.$connect();
  if (shuttingDown) return;

  worker = createWorker();

  worker.on("failed", (job, error) => {
    const configuredAttempts = job?.opts.attempts ?? 1;
    const finalFailure = !job || job.attemptsMade >= configuredAttempts;

    if (finalFailure) recordQueueFailure();

    logger.error("background.job.failed", {
      jobId: job?.id,
      jobName: job?.name,
      attemptsMade: job?.attemptsMade,
      finalFailure,
      errorName: error.name,
      errorMessage:
        process.env.NODE_ENV === "production" ? undefined : error.message,
    });
  });

  worker.on("error", (error) => {
    logger.error("background.worker.error", {
      errorName: error.name,
      errorMessage:
        process.env.NODE_ENV === "production" ? undefined : error.message,
    });
  });

  await worker.waitUntilReady();
  if (shuttingDown) return;

  // Register the repeatable report job. BullMQ keeps the repeat schedule in
  // Redis between short-lived scheduled worker executions.
  await scheduleDailyReport();

  // The API normally runs this publisher too. Starting it here provides a
  // recovery path when the free API host is asleep; PostgreSQL row locking
  // with SKIP LOCKED allows multiple publisher instances to cooperate.
  startOutboxPublisher();

  logger.info("background.worker.ready", {
    queue: BACKGROUND_QUEUE_NAME,
    concurrency: 5,
    dailyReportCron: env.backgroundJobs.dailyReportCron,
    mode: scheduledRunDurationMs === null ? "continuous" : "scheduled-bounded",
    scheduledRunDurationMs,
  });

  if (scheduledRunDurationMs !== null) {
    scheduledRunTimer = setTimeout(() => {
      void shutdownWorker("scheduled run completed");
    }, scheduledRunDurationMs);
  }
};

void start().catch(async (error: unknown) => {
  logger.error("background.worker.startup_failed", {
    errorName: error instanceof Error ? error.name : "UnknownError",
    errorMessage:
      process.env.NODE_ENV === "production" || !(error instanceof Error)
        ? undefined
        : error.message,
  });

  await shutdownWorker("startup failure");
  process.exitCode = 1;
});
