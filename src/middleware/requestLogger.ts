import type { Request, Response, NextFunction } from "express";
import { logger } from "../observability/logger";
import { getMetricEndpoint, recordRequest } from "../observability/metrics";

export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = process.hrtime.bigint();
  const startedAt = new Date().toISOString();
  // Never log query strings or request bodies: they can contain credentials or sensitive data.
  const initialPath = req.path || req.originalUrl.split("?")[0] || "/";

  res.on("finish", () => {
    const latencyMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
    const endpoint = getMetricEndpoint(req) || initialPath;
    recordRequest({ method: req.method, endpoint, status: res.statusCode, latencyMs });

    logger.info("http.request.completed", {
      requestId: req.requestId,
      userId: req.user?.id ?? null,
      method: req.method,
      endpoint,
      status: res.statusCode,
      latencyMs: Number(latencyMs.toFixed(2)),
      startedAt,
      ip: req.ip,
    });
  });

  next();
};