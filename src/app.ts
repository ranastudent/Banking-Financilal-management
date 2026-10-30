import express from "express";
import { prisma } from "./config/prisma";
import { redis } from "./config/redis";
import { requestIdMiddleware } from "./middleware/requestId";
import { errorHandler } from "./middleware/errorHandler";
import { AppError } from "./errors/AppError";
import { ErrorCode } from "./errors/errorCodes";
import { requestLogger } from "./middleware/requestLogger";
import validationTestRouter from "./routes/validationTest";
import helmet from "helmet";
import { corsMiddleware } from "./config/cors";
import { generalRateLimiter } from "./middleware/rateLimiter";
import { env } from "./config/env";
import routes from "./routes";
import { openApiSpec, swaggerUiMiddleware } from "./docs/swagger";
import { metricsHandler } from "./observability/metrics";


const app = express();

app.use(helmet());
app.use(corsMiddleware);
app.use(requestIdMiddleware);
app.use(requestLogger);
app.use(express.json({ limit: env.bodySizeLimit }));
app.use(generalRateLimiter);

app.use("/api/v1", routes);

// Interactive OpenAPI/Swagger UI is available only outside production.
// Open http://localhost:<PORT>/api-docs to explore the documented API.
if (env.nodeEnv !== "production") {
  app.use("/api-docs", swaggerUiMiddleware.serve, swaggerUiMiddleware.setup(openApiSpec));
  app.get("/api-docs.json", (_req, res) => res.json(openApiSpec));
}

// Diagnostic routes are intentionally unavailable in production. They can
// expose implementation details or trigger noisy error paths if left public.
if (env.nodeEnv !== "production") {
  app.use("/test-validation", validationTestRouter);
}

app.get("/health", async (req, res) => {
  
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
    requestId: req.requestId,
  });
});

// Metrics are intentionally exposed only outside production until an
// authenticated/internal-network access policy is configured for deployment.
if (env.nodeEnv !== "production") {
  app.get("/metrics", metricsHandler);
}

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

if (env.nodeEnv !== "production") {
  app.get("/test-error", (_req, _res) => {
    throw new Error("This is a test internal error");
  });

  app.get("/test-app-error", (_req, _res) => {
    throw new AppError(
      "Account not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  });
}

app.use((req, _res, next) => {
  next(
    new AppError(
      "Resource not found",
      404,
      ErrorCode.NOT_FOUND,
    ),
  );
});



/*
 * Global error handler
 *
 * IMPORTANT:
 * This must be registered after routes.
 */
app.use(errorHandler);



export default app;