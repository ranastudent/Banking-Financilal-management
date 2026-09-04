import type { Server } from "node:http";
import { prisma } from "../config/prisma";
import { redis } from "../config/redis";

let isShuttingDown = false;

export const shutdown = async (
  server: Server,
  signal: string,
): Promise<void> => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  console.log(`${signal} received. Shutting down...`);

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  try {
    await prisma.$disconnect();
    console.log("PostgreSQL disconnected");

    if (redis.isOpen) {
      await redis.quit();
      console.log("Redis disconnected");
    }

    console.log("Server shut down successfully");
  } catch (error) {
    console.error("Error during shutdown:", error);
    throw error;
  }
};

/**
 * Reset shutdown state.
 *
 * This is mainly useful for testing.
 */
export const resetShutdownState = (): void => {
  isShuttingDown = false;
};