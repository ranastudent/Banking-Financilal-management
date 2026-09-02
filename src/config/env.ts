import "dotenv/config";

const requiredEnv = [
  "DATABASE_URL",
  "REDIS_URL",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "DEFAULT_ADMIN_EMAIL",
  "DEFAULT_ADMIN_PASSWORD",
  "CORS_ORIGINS",
] as const;

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export const env = {
  port: Number(process.env.PORT) || 5000,

  databaseUrl: process.env.DATABASE_URL!,

  redisUrl: process.env.REDIS_URL!,

  jwtAccessSecret: process.env.JWT_ACCESS_SECRET!,

  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET!,

  defaultAdminEmail: process.env.DEFAULT_ADMIN_EMAIL!,

  defaultAdminPassword: process.env.DEFAULT_ADMIN_PASSWORD!,
  corsOrigins: process.env.CORS_ORIGINS!
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean),

  rateLimit: {
  general: {
    windowMs:
      Number(process.env.GENERAL_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,

    max:
      Number(process.env.GENERAL_RATE_LIMIT_MAX) || 100,
  },

  auth: {
    windowMs:
      Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,

    max:
      Number(process.env.AUTH_RATE_LIMIT_MAX) || 10,
  },

  otp: {
    windowMs:
      Number(process.env.OTP_RATE_LIMIT_WINDOW_MS) || 10 * 60 * 1000,

    max:
      Number(process.env.OTP_RATE_LIMIT_MAX) || 5,
  },
},
};