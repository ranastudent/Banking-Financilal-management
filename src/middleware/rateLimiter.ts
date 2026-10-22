import rateLimit from "express-rate-limit";
import type { Request, Response } from "express";
import { RedisStore } from "rate-limit-redis";

import { env } from "../config/env";
import { ensureRedisConnected, redis } from "../config/redis";

const createRedisStore = (prefix: string) =>
  new RedisStore({
    sendCommand: (...args: string[]) =>
      ensureRedisConnected().then(() => redis.sendCommand(args)),
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

export const generalRateLimiter = rateLimit({
  windowMs: env.rateLimit.general.windowMs,
  limit: env.rateLimit.general.max,
  store: createRedisStore("rl:general:"),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: createRateLimitHandler(
    "RATE_LIMIT_EXCEEDED",
    "Too many requests. Please try again later.",
  ),
});

export const authRateLimiter = rateLimit({
  windowMs: env.rateLimit.auth.windowMs,
  limit: env.rateLimit.auth.max,
  store: createRedisStore("rl:auth:"),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: createRateLimitHandler(
    "AUTH_RATE_LIMIT_EXCEEDED",
    "Too many authentication attempts. Please try again later.",
  ),
});

export const otpRateLimiter = rateLimit({
  windowMs: env.rateLimit.otp.windowMs,
  limit: env.rateLimit.otp.max,
  store: createRedisStore("rl:otp:"),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: createRateLimitHandler(
    "OTP_RATE_LIMIT_EXCEEDED",
    "Too many OTP requests. Please try again later.",
  ),
});

export const transferRateLimiter = rateLimit({
  windowMs: env.rateLimit.transfer.windowMs,
  limit: env.rateLimit.transfer.max,
  store: createRedisStore("rl:transfer:"),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: createRateLimitHandler(
    "TRANSFER_RATE_LIMIT_EXCEEDED",
    "Too many transfer requests. Please try again later.",
  ),
});
