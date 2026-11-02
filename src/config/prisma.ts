import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { env } from "./env";
import { logger } from "../observability/logger";
import { recordDatabaseQuery } from "../observability/metrics";

const adapter = new PrismaPg({
  connectionString: env.databaseUrl,
  max: env.database.pool.max,
  // Avoid waiting indefinitely for a stale or unavailable pooled connection.
  connectionTimeoutMillis: 15_000,
  // Retire idle connections periodically; TCP keep-alive helps detect dead peers.
  idleTimeoutMillis: 30_000,
  keepAlive: true,
});

export const prisma = new PrismaClient({
  adapter,
  // Query events expose SQL and parameters. The handler below deliberately
  // records timing only and never logs query text or parameter values.
  log: [{ emit: "event", level: "query" }],

  transactionOptions: {
    maxWait: env.database.transaction.maxWaitMs,
    timeout: env.database.transaction.timeoutMs,
  },
});

const slowQueryThresholdMs = env.observability.slowQueryThresholdMs;

prisma.$on("query", (event) => {
  const durationMs = event.duration;
  const slow = durationMs >= slowQueryThresholdMs;

  recordDatabaseQuery(durationMs, slow);

  if (slow) {
    // Do not log event.query or event.params: either may contain sensitive data.
    logger.warn("database.query.slow", {
      durationMs: Number(durationMs.toFixed(2)),
      thresholdMs: slowQueryThresholdMs,
    });
  }
});
