import type { Server } from "node:http";
import { prisma } from "../config/prisma";
import { redis } from "../config/redis";

let isShuttingDown = false;

export const shutdown = async (
  server: Server,
  signal: string,
): Promise<void> => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`${signal} received. Shutting down...`);

  const errors: unknown[] = [];
  const cleanup = async (label: string, action: () => Promise<unknown>) => {
    try { await action(); console.log(`${label} closed`); }
    catch (error) { errors.push(error); console.error(`Error closing ${label}:`, error); }
  };

  await cleanup("HTTP server", () => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  // Each resource is attempted independently so one failure does not skip the
  // remaining cleanup operations.
  await cleanup("outbox publisher", async () => {
    const { stopOutboxPublisher } = await import("../jobs/outbox-publisher.js");
    await stopOutboxPublisher();
  });
  await cleanup("background queue", async () => {
    const { closeBackgroundQueue } = await import("../jobs/queues.js");
    await closeBackgroundQueue();
  });
  await cleanup("PostgreSQL", () => prisma.$disconnect());
  if (redis.isOpen) await cleanup("Redis", () => redis.quit());

  if (errors.length) throw new AggregateError(errors, "Shutdown completed with errors");
  console.log("Server shut down successfully");
};

/**
 * Reset shutdown state.
 *
 * This is mainly useful for testing.
 */
export const resetShutdownState = (): void => {
  isShuttingDown = false;
};