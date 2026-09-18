import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { env } from "./env";

const adapter = new PrismaPg({
  connectionString: env.databaseUrl,
  max: env.database.pool.max,
});

export const prisma = new PrismaClient({
  adapter,

  transactionOptions: {
    maxWait: env.database.transaction.maxWaitMs,
    timeout: env.database.transaction.timeoutMs,
  },
});