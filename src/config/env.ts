import "dotenv/config";

const requiredEnv = [
  "DATABASE_URL",
  "REDIS_URL",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "DEFAULT_ADMIN_EMAIL",
  "DEFAULT_ADMIN_PASSWORD",
  "CORS_ORIGINS",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "EMAIL_FROM",
] as const;

for (const key of requiredEnv) {
  const value = process.env[key]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const parsePositiveNumber = (
  value: string | undefined,
  fallback: number,
  name: string,
): number => {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid environment variable: ${name}`);
  }

  return parsed;
};

const parsePositiveDecimalString = (
  value: string | undefined,
  fallback: string,
  name: string,
): string => {
  const normalized = value?.trim() || fallback;

  if (
    !/^\d+(\.\d{1,8})?$/.test(normalized) ||
    /^0+(\.0+)?$/.test(normalized)
  ) {
    throw new Error(
      `Invalid environment variable: ${name}`,
    );
  }

  return normalized;
};

export const env = {
  // ==========================================
  // SERVER
  // ==========================================

  port: parsePositiveNumber(
    process.env.PORT,
    5000,
    "PORT",
  ),

  // ==========================================
  // DATABASE
  // ==========================================

  // Keep this because existing project code uses env.databaseUrl
  databaseUrl: process.env.DATABASE_URL!,

  database: {
    url: process.env.DATABASE_URL!,

    pool: {
      max: parsePositiveNumber(
        process.env.DATABASE_POOL_MAX,
        10,
        "DATABASE_POOL_MAX",
      ),
    },

    transaction: {
      maxWaitMs: parsePositiveNumber(
        process.env.DATABASE_TX_MAX_WAIT_MS,
        2000,
        "DATABASE_TX_MAX_WAIT_MS",
      ),

      timeoutMs: parsePositiveNumber(
        process.env.DATABASE_TX_TIMEOUT_MS,
        5000,
        "DATABASE_TX_TIMEOUT_MS",
      ),
    },
  },

  // ==========================================
  // REDIS
  // ==========================================

  redisUrl: process.env.REDIS_URL!,

  // ==========================================
  // JWT
  // ==========================================

  jwtAccessSecret: process.env.JWT_ACCESS_SECRET!,

  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET!,

  // ==========================================
  // DEFAULT ADMIN
  // ==========================================

  defaultAdminEmail: process.env.DEFAULT_ADMIN_EMAIL!,

  defaultAdminPassword: process.env.DEFAULT_ADMIN_PASSWORD!,

  // ==========================================
  // CORS
  // ==========================================

  corsOrigins: process.env.CORS_ORIGINS!
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),

  // ==========================================
  // EMAIL / SMTP
  // ==========================================

  email: {
    smtpHost: process.env.SMTP_HOST!,

    smtpPort: parsePositiveNumber(
      process.env.SMTP_PORT,
      587,
      "SMTP_PORT",
    ),

    smtpUser: process.env.SMTP_USER!,

    smtpPassword: process.env.SMTP_PASSWORD!,

    from: process.env.EMAIL_FROM!,

    fromName:
      process.env.EMAIL_FROM_NAME?.trim() || "Banking Platform",
  },

  // ==========================================
  // BODY SIZE
  // ==========================================

  bodySizeLimit:
    process.env.BODY_SIZE_LIMIT?.trim() || "1mb",

  // ==========================================
  // RATE LIMITING
  // ==========================================

     // ==========================================
  // RATE LIMITING
  // ==========================================

  rateLimit: {
    general: {
      windowMs:
        Number(process.env.GENERAL_RATE_LIMIT_WINDOW_MS) ||
        15 * 60 * 1000,

      max:
        Number(process.env.GENERAL_RATE_LIMIT_MAX) ||
        100,
    },

    auth: {
      windowMs:
        Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS) ||
        15 * 60 * 1000,

      max:
        Number(process.env.AUTH_RATE_LIMIT_MAX) ||
        10,
    },

    otp: {
      windowMs:
        Number(process.env.OTP_RATE_LIMIT_WINDOW_MS) ||
        10 * 60 * 1000,

      max:
        Number(process.env.OTP_RATE_LIMIT_MAX) ||
        5,
    },
  },

  // ==========================================
  // WITHDRAWAL
  // ==========================================

  withdrawal: {
    maxAmount: parsePositiveDecimalString(
      process.env.WITHDRAWAL_MAX_AMOUNT,
      "50000.00",
      "WITHDRAWAL_MAX_AMOUNT",
    ),
  },
};
