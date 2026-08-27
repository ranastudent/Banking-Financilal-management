import app from "./app";
import { env } from "./config/env";
import { prisma } from "./config/prisma";
import { redis } from "./config/redis";

async function startServer() {
  try {
    await prisma.$connect();
    console.log("PostgreSQL connected successfully");

    await redis.connect();
    console.log("Redis connected successfully");

    const server = app.listen(env.port, () => {
      console.log(`Server running on port ${env.port}`);
    });

    const shutdown = async (signal: string) => {
      console.log(`${signal} received. Shutting down...`);

      server.close(async () => {
        await prisma.$disconnect();

        if (redis.isOpen) {
          await redis.quit();
        }

        console.log("Server shut down successfully");
        process.exit(0);
      });
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (error) {
    console.error("Failed to start server:", error);

    await prisma.$disconnect();

    if (redis.isOpen) {
      await redis.quit();
    }

    process.exit(1);
  }
}

startServer();