/**
 * Shared integration-test reference data.
 *
 * This module is imported only by test files. It seeds the baseline currencies
 * before each test file's tests execute. Production modules do not import this
 * file, so production behavior and features remain unchanged.
 *
 * IMPORTANT: run the test suite only against a dedicated test database.
 */
import { beforeAll } from "vitest";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { ensureRedisConnected, redis } from "../config/redis";

const isTransientDatabaseConnectionError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";

  return (
    ["P1001", "P1002", "P1017", "ECONNRESET", "ETIMEDOUT", "EPIPE", "57P01"].includes(code) ||
    /can't reach database server|connection terminated unexpectedly|connection reset|connection timed out|server closed the connection/i.test(
      message,
    )
  );
};

const verifyDatabaseConnectionWithRetry = async (): Promise<
  Array<{ database_name: string }>
> => {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await prisma.$queryRawUnsafe<
        Array<{ database_name: string }>
      >("SELECT current_database() AS database_name");
    } catch (error) {
      if (
        attempt === maxAttempts ||
        !isTransientDatabaseConnectionError(error)
      ) {
        throw error;
      }

      const delayMs = attempt * 1000;
      console.warn(
        `[test-safety] Temporary PostgreSQL connection failure (attempt ${attempt}/${maxAttempts}); retrying in ${delayMs}ms.`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error("Test database connection could not be verified.");
};

const assertDedicatedTestInfrastructure = async (): Promise<void> => {
  if (env.nodeEnv !== "test") {
    throw new Error(
      "Integration tests require NODE_ENV=test. Refusing to seed reference data.",
    );
  }

  // Verify the actual database reached, not only the URL supplied by the shell.
  // Retry only transient connectivity failures; safety mismatches are never retried.
  const rows = await verifyDatabaseConnectionWithRetry();
  const actualDatabaseName = rows[0]?.database_name;

  if (!actualDatabaseName || actualDatabaseName !== env.test.databaseName) {
    throw new Error(
      "Test database safety check failed: connected PostgreSQL database does not match TEST_DATABASE_NAME.",
    );
  }

  // Verify the isolated Redis endpoint is reachable before any test writes.
  await ensureRedisConnected();
  const redisPing = await redis.ping();

  if (redisPing !== "PONG") {
    throw new Error("Test Redis safety check failed: Redis did not return PONG.");
  }

  console.info(
    `[test-safety] Approved test infrastructure: PostgreSQL database "${actualDatabaseName}" and dedicated Redis host "${env.test.redisHost}".`,
  );
};


const requiredCurrencies = [
  { code: "BDT", name: "Bangladeshi Taka", symbol: "৳", decimalPlaces: 2 },
  { code: "EUR", name: "Euro", symbol: "€", decimalPlaces: 2 },
  { code: "GBP", name: "Pound Sterling", symbol: "£", decimalPlaces: 2 },
  { code: "JPY", name: "Japanese Yen", symbol: "¥", decimalPlaces: 0 },
  { code: "USD", name: "United States Dollar", symbol: "$", decimalPlaces: 2 },
] as const;

beforeAll(async () => {
  await assertDedicatedTestInfrastructure();

  for (const currency of requiredCurrencies) {
    await prisma.currency.upsert({
      where: { code: currency.code },
      update: { isActive: true },
      create: { ...currency, isActive: true },
    });
  }
});
