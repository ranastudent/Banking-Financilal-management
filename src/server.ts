import app from "./app";
import { env } from "./config/env";
import { prisma } from "./config/prisma";
import { redis } from "./config/redis";

async function startServer() {
  try {
    // --------------------------------
    // Database connection
    // --------------------------------
    await prisma.$connect();
    console.log("PostgreSQL connected successfully");

    // --------------------------------
    // Redis connection
    // --------------------------------
    await redis.connect();
    console.log("Redis connected successfully");

    // --------------------------------
    // Start HTTP server
    // --------------------------------
    const server = app.listen(env.port, () => {
      console.log(`Server running on port ${env.port}`);
    });

    // --------------------------------
    // Graceful shutdown
    // --------------------------------
    let isShuttingDown = false;

    const shutdown = async (signal: string) => {
      if (isShuttingDown) {
        return;
      }

      isShuttingDown = true;

      console.log(`${signal} received. Shutting down...`);

      server.close(async () => {
        try {
          await prisma.$disconnect();
          console.log("PostgreSQL disconnected");

          if (redis.isOpen) {
            await redis.quit();
            console.log("Redis disconnected");
          }

          console.log("Server shut down successfully");

          process.exit(0);
        } catch (error) {
          console.error("Error during shutdown:", error);

          process.exit(1);
        }
      });
    };

    // --------------------------------
    // Process signals
    // --------------------------------
    process.on("SIGTERM", () => {
      void shutdown("SIGTERM");
    });

    process.on("SIGINT", () => {
      void shutdown("SIGINT");
    });
  } catch (error) {
    console.error("Failed to start server:", error);

    try {
      await prisma.$disconnect();
    } catch {
      console.error("Failed to disconnect PostgreSQL");
    }

    try {
      if (redis.isOpen) {
        await redis.quit();
      }
    } catch {
      console.error("Failed to disconnect Redis");
    }

    process.exit(1);
  }
}

void startServer();