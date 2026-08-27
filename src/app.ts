import express from "express";
import { prisma } from "./config/prisma";
import { redis } from "./config/redis";

const app = express();

app.use(express.json());

/*app.get("/api/v1/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Banking Platform API is running",
  });
});*/

app.get("/health", async (_req, res) => {
  let database = "disconnected";
  let redisStatus = "disconnected";

  try {
    await prisma.$queryRaw`SELECT 1`;
    database = "connected";
  } catch {
    database = "disconnected";
  }

  try {
    const result = await redis.ping();

    if (result === "PONG") {
      redisStatus = "connected";
    }
  } catch {
    redisStatus = "disconnected";
  }

  const healthy =
    database === "connected" &&
    redisStatus === "connected";

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    database,
    redis: redisStatus,
  });
});

app.get("/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await redis.ping();

    res.status(200).json({
      ready: true,
    });
  } catch {
    res.status(503).json({
      ready: false,
    });
  }
});



export default app;