import app from "./app";
import { env } from "./config/env";
import { prisma } from "./config/prisma";
import { redis } from "./config/redis";
import { shutdown } from "./utils/shutdown";

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
    // Process signals
    // --------------------------------
    process.on("SIGTERM", () => {
      void shutdown(server, "SIGTERM")
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    });

    process.on("SIGINT", () => {
      void shutdown(server, "SIGINT")
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
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