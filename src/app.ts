import express from "express";
import compression from "compression";
import { prisma } from "./config/prisma";
import { pingRedis } from "./config/redis";
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
// Compress eligible responses above 1 KiB. Compression is transport-only and
// does not alter JSON values, database writes, or financial calculations.
app.use(compression({
  threshold: 1024,
  // Avoid compression side-channel exposure on authenticated or authentication
  // responses. Public, non-sensitive responses remain eligible for compression.
  filter: (req, res) => {
    const path = req.path.toLowerCase();
    if (
      req.headers.authorization ||
      req.headers.cookie ||
      path.includes("/auth")
    ) {
      return false;
    }
    return compression.filter(req, res);
  },
}));
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


app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    requestId: req.requestId,
  });
});

// Metrics are intentionally exposed only outside production until an
// authenticated/internal-network access policy is configured for deployment.
if (env.nodeEnv !== "production") {
  app.get("/metrics", metricsHandler);
}

app.get("/ready", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await pingRedis();

    res.status(200).json({
      ready: true,
      requestId: req.requestId,
    });
  } catch {
    res.status(503).json({
      ready: false,
      requestId: req.requestId,
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