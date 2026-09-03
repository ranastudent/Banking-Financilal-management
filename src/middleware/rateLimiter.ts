import rateLimit from "express-rate-limit";

import { env } from "../config/env";

export const generalRateLimiter = rateLimit({
  windowMs: env.rateLimit.general.windowMs,

  limit: env.rateLimit.general.max,

  standardHeaders: "draft-7",

  legacyHeaders: false,

  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many requests. Please try again later.",
      },
      requestId: req.requestId,
    });
  },
});

export const authRateLimiter = rateLimit({
  windowMs: env.rateLimit.auth.windowMs,

  limit: env.rateLimit.auth.max,

  standardHeaders: "draft-7",

  legacyHeaders: false,

  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code: "AUTH_RATE_LIMIT_EXCEEDED",
        message: "Too many authentication attempts. Please try again later.",
      },
      requestId: req.requestId,
    });
  },
});

export const otpRateLimiter = rateLimit({
  windowMs: env.rateLimit.otp.windowMs,

  limit: env.rateLimit.otp.max,

  standardHeaders: "draft-7",

  legacyHeaders: false,

  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code: "OTP_RATE_LIMIT_EXCEEDED",
        message: "Too many OTP requests. Please try again later.",
      },
      requestId: req.requestId,
    });
  },
});