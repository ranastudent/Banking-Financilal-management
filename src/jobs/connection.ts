import IORedis from "ioredis";
import { env } from "../config/env";

const attachErrorLogging = (connection: IORedis, label: string): IORedis => {
  connection.on("error", (error: Error) => {
    console.error(`[${label}] Redis connection error`, error.message);
  });
  return connection;
};

export const createBullMqConnection = (): IORedis =>
  attachErrorLogging(
    new IORedis(env.redisUrl, {
      // BullMQ workers need blocking commands and must not fail requests
      // because ioredis exhausted a short per-request retry budget.
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    }),
    "background-worker",
  );

export const createBullMqQueueConnection = (): IORedis =>
  attachErrorLogging(
    new IORedis(env.redisUrl, {
      // The API's outbox publisher should fail a queue.add quickly if Redis
      // is unavailable so it can leave the event pending and retry next poll.
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
    }),
    "background-queue",
  );
