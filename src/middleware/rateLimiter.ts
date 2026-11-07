import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { NextFunction, Request, Response } from "express";
import { RedisStore } from "rate-limit-redis";

import { env } from "../config/env";
import { ensureRedisConnected, redis } from "../config/redis";
import { recordRedisOperation } from "../observability/metrics";

const isTestEnvironment =
  process.env.NODE_ENV === "test" || process.env.VITEST === "true";

/**
 * In tests, route-specific rate limits run only when a test explicitly opts in.
 * This prevents the global limiter and unrelated tests from sharing counters.
 * Production behavior is unchanged.
 */
const testAwareLimiter = (
  limiter: ReturnType<typeof rateLimit>,
  options: { skipInTests?: boolean } = {},
) => (req: Request, res: Response, next: NextFunction) => {
  if (
    isTestEnvironment &&
    (options.skipInTests || req.get("X-Test-Rate-Limit") !== "true")
  ) {
    next();
    return;
  }

  limiter(req, res, next);
};

const rateLimitKeyGenerator = (req: Request): string => {
  const testKey = req.get("X-Test-Rate-Limit-Key");
  if (isTestEnvironment && testKey) {
    return `test:${testKey}`;
  }

  return ipKeyGenerator(req.ip ?? "127.0.0.1");
};

const createRedisStore = (prefix: string) =>
  new RedisStore({
    sendCommand: async (...args: string[]) => {
      const startedAt = process.hrtime.bigint();
      try {
        await ensureRedisConnected();
        const result = await redis.sendCommand(args);
        recordRedisOperation(Number(process.hrtime.bigint() - startedAt) / 1_000_000);
        return result as never ;
      } catch (error) {
        recordRedisOperation(
          Number(process.hrtime.bigint() - startedAt) / 1_000_000,
          true,
        );
        throw error;
      }
    },
    prefix,
  });

const createRateLimitHandler = (code: string, message: string) =>
  (req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      error: { code, message },
      requestId: req.requestId,
    });
  };

const generalRateLimiterImpl = rateLimit({
  windowMs: env.rateLimit.general.windowMs,
  limit: env.rateLimit.general.max,
  skip: (req) =>
    req.path === "/health" ||
    req.path === "/ready",
  keyGenerator: rateLimitKeyGenerator,
  store: createRedisStore(`${env.redisKeyPrefix}rl:general:`),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: createRateLimitHandler(
    "RATE_LIMIT_EXCEEDED",
    "Too many requests. Please try again later.",
  ),
});

const authRateLimiterImpl = rateLimit({
  windowMs: env.rateLimit.auth.windowMs,
  limit: env.rateLimit.auth.max,
  keyGenerator: rateLimitKeyGenerator,
  store: createRedisStore(`${env.redisKeyPrefix}rl:auth:`),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: createRateLimitHandler(
    "AUTH_RATE_LIMIT_EXCEEDED",
    "Too many authentication attempts. Please try again later.",
  ),
});

const otpRateLimiterImpl = rateLimit({
  windowMs: env.rateLimit.otp.windowMs,
  limit: env.rateLimit.otp.max,
  keyGenerator: rateLimitKeyGenerator,
  store: createRedisStore(`${env.redisKeyPrefix}rl:otp:`),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: createRateLimitHandler(
    "OTP_RATE_LIMIT_EXCEEDED",
    "Too many OTP requests. Please try again later.",
  ),
});

const transferRateLimiterImpl = rateLimit({
  windowMs: env.rateLimit.transfer.windowMs,
  limit: env.rateLimit.transfer.max,
  keyGenerator: rateLimitKeyGenerator,
  store: createRedisStore(`${env.redisKeyPrefix}rl:transfer:`),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: createRateLimitHandler(
    "TRANSFER_RATE_LIMIT_EXCEEDED",
    "Too many transfer requests. Please try again later.",
  ),
});

const transactionHistoryRateLimiterImpl = rateLimit({
  windowMs: env.rateLimit.transactionHistory.windowMs,
  limit: env.rateLimit.transactionHistory.max,
  keyGenerator: rateLimitKeyGenerator,
  store: createRedisStore(`${env.redisKeyPrefix}rl:transaction-history:`),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: createRateLimitHandler(
    "TRANSACTION_HISTORY_RATE_LIMIT_EXCEEDED",
    "Too many transaction history requests. Please try again later.",
  ),
});

// The global limiter is skipped in test mode. Dedicated tests opt in to the
// route-specific limiter with X-Test-Rate-Limit: true.
export const generalRateLimiter = testAwareLimiter(generalRateLimiterImpl, {
  skipInTests: true,
});
export const authRateLimiter = testAwareLimiter(authRateLimiterImpl);
export const otpRateLimiter = testAwareLimiter(otpRateLimiterImpl);
export const transferRateLimiter = testAwareLimiter(transferRateLimiterImpl);
export const transactionHistoryRateLimiter = testAwareLimiter(
  transactionHistoryRateLimiterImpl,
);
