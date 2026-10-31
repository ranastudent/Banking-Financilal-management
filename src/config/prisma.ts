import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { env } from "./env";

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

  transactionOptions: {
    maxWait: env.database.transaction.maxWaitMs,
    timeout: env.database.transaction.timeoutMs,
  },
});