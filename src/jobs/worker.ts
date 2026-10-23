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
  handleSendEmail,
  handleSendNotification,
} from "./handlers";
import type {
  BackgroundJobData,
  BackgroundJobName,
  ReportJobPayload,
  TransferCommittedPayload,
} from "./types";
import { isTransferCommittedPayload } from "./types";

let workerConnection: ReturnType<typeof createBullMqConnection> | null = null;
let worker: Worker<BackgroundJobData, void, BackgroundJobName> | null = null;

const createWorker = (): Worker<BackgroundJobData, void, BackgroundJobName> => {
  workerConnection = createBullMqConnection();
  return new Worker<BackgroundJobData, void, BackgroundJobName>(
    BACKGROUND_QUEUE_NAME,
    async (job: Job<BackgroundJobData, void, BackgroundJobName>) => {
      console.info("[background-worker] job started", {
        jobId: job.id, name: job.name, attemptsMade: job.attemptsMade,
      });
      if (job.name === "generate-report") {
        await handleGenerateReport(job.data as ReportJobPayload, job.timestamp);
      } else {
        if (!isTransferCommittedPayload(job.data)) throw new Error(`Invalid payload for job ${job.name}`);
        const payload = job.data as TransferCommittedPayload;
        switch (job.name) {
          case "send-email": await handleSendEmail(payload); break;
          case "send-notification": await handleSendNotification(payload); break;
          case "process-audit-event": await handleProcessAuditEvent(payload); break;
          case "risk-analysis": await handleRiskAnalysis(payload); break;
          default: { const exhaustive: never = job.name; throw new Error(`Unsupported background job: ${exhaustive}`); }
        }
      }
      console.info("[background-worker] job completed", { jobId: job.id, name: job.name });
    },
    { connection: workerConnection, concurrency: 5 },
  );
};

let shuttingDown = false;
const shutdownWorker = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`[background-worker] ${signal} received; closing worker`);
  const errors: unknown[] = [];
  const cleanup = async (label: string, action: () => Promise<unknown>) => {
    try { await action(); } catch (error) { errors.push(error); console.error(`[background-worker] ${label} cleanup failed`, error); }
  };
  if (worker) await cleanup("worker", () => worker!.close());
  if (workerConnection && workerConnection.status !== "end") await cleanup("worker Redis", () => workerConnection!.quit());
  await cleanup("queue", () => closeBackgroundQueue());
  await cleanup("Prisma", () => prisma.$disconnect());
  if (errors.length) {
    console.error("[background-worker] shutdown completed with cleanup errors", errors);
    process.exitCode = 1;
  } else {
    console.info("[background-worker] shutdown complete");
  }
};

process.once("SIGTERM", () => void shutdownWorker("SIGTERM"));
process.once("SIGINT", () => void shutdownWorker("SIGINT"));

const start = async (): Promise<void> => {
  // Do not construct the Worker until Prisma is connected: BullMQ may start
  // consuming as soon as the Worker instance is created.
  await prisma.$connect();
  if (shuttingDown) return;
  worker = createWorker();
  worker.on("failed", (job, error) => {
    console.error("[background-worker] job failed", { jobId: job?.id, name: job?.name, attemptsMade: job?.attemptsMade, error: error.message });
  });
  worker.on("error", (error) => console.error("[background-worker] worker error", error));
  await worker.waitUntilReady();
  if (shuttingDown) return;
  await scheduleDailyReport();
  console.info("[background-worker] ready", { queue: BACKGROUND_QUEUE_NAME, concurrency: 5, dailyReportCron: env.backgroundJobs.dailyReportCron });
};

void start().catch(async (error: unknown) => {
  console.error("[background-worker] startup failed", error);
  await shutdownWorker("startup failure");
  process.exitCode = 1;
});
