import { z } from "zod";
import {
  TransactionStatus,
  TransactionType,
} from "@prisma/client";

// ============================================================
// CONSTANTS
// ============================================================

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const DECIMAL_PATTERN = /^\d+(\.\d{1,8})?$/;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_PAGE = 2_147_483_647;
const MAX_INTEGER_DIGITS = 16;
const MAX_DECIMAL_PLACES = 8;

// ============================================================
// DATE VALIDATION
// ============================================================

/**
 * Validates an optional date in YYYY-MM-DD format.
 *
 * Checks both the format and whether the date is a valid
 * calendar date.
 *
 * Examples:
 *   2026-10-21 -> valid
 *   2026-02-30 -> invalid
 *   21-10-2026 -> invalid
 */
const optionalDateSchema = z
  .string()
  .trim()
  .regex(
    DATE_PATTERN,
    "Date must use YYYY-MM-DD format",
  )
  .refine(
    (value) => {
      const date = new Date(`${value}T00:00:00.000Z`);

      return (
        !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
      );
    },
    {
      message: "Date must be a valid calendar date",
    },
  )
  .optional();

// ============================================================
// AMOUNT VALIDATION
// ============================================================

/**
 * Validates a non-negative monetary amount.
 *
 * Matches the precision of Prisma Decimal(24, 8):
 *   - Maximum 16 integer digits
 *   - Maximum 8 fractional digits
 *
 * Amounts remain strings to avoid floating-point precision loss.
 *
 * Examples:
 *   100       -> valid
 *   100.25    -> valid
 *   0.12345678 -> valid
 *   -100      -> invalid
 *   10.123456789 -> invalid
 */
const optionalAmountSchema = z
  .string()
  .trim()
  .regex(
    DECIMAL_PATTERN,
    `Amount must be a non-negative decimal with up to ${MAX_DECIMAL_PLACES} decimal places`,
  )
  .refine(
    (value) => {
      const [integerPart = ""] = value.split(".");

      return integerPart.length <= MAX_INTEGER_DIGITS;
    },
    {
      message: "Amount exceeds the supported precision",
    },
  )
  .optional();

// ============================================================
// DECIMAL COMPARISON HELPERS
// ============================================================

/**
 * Normalizes a decimal string without using floating-point math.
 *
 * Examples:
 *   "00100.5000" -> "100.5"
 *   "00025.000"  -> "25"
 *   "0.5000"     -> "0.5"
 */
const normalizeDecimal = (value: string): string => {
  const [integerPart = "0", fractionalPart = ""] =
    value.split(".");

  const normalizedInteger = integerPart.replace(
    /^0+(?=\d)/,
    "",
  );

  const normalizedFraction = fractionalPart.replace(/0+$/, "");

  if (normalizedFraction.length === 0) {
    return normalizedInteger;
  }

  return `${normalizedInteger}.${normalizedFraction}`;
};

/**
 * Compares two non-negative decimal strings precisely.
 *
 * Returns:
 *   -1 if first < second
 *    0 if first = second
 *    1 if first > second
 *
 * This avoids Number conversion, which can introduce
 * precision errors for large monetary amounts.
 */
const compareDecimals = (
  first: string,
  second: string,
): number => {
  const normalizedFirst = normalizeDecimal(first);
  const normalizedSecond = normalizeDecimal(second);

  const [firstInteger = "0", firstFraction = ""] =
    normalizedFirst.split(".");

  const [secondInteger = "0", secondFraction = ""] =
    normalizedSecond.split(".");

  // Step 1: Compare integer-part lengths.
  if (firstInteger.length !== secondInteger.length) {
    return firstInteger.length > secondInteger.length ? 1 : -1;
  }

  // Step 2: Compare integer parts.
  if (firstInteger !== secondInteger) {
    return firstInteger > secondInteger ? 1 : -1;
  }

  // Step 3: Compare fractional parts.
  const fractionLength = Math.max(
    firstFraction.length,
    secondFraction.length,
  );

  const paddedFirstFraction = firstFraction.padEnd(
    fractionLength,
    "0",
  );

  const paddedSecondFraction = secondFraction.padEnd(
    fractionLength,
    "0",
  );

  if (paddedFirstFraction === paddedSecondFraction) {
    return 0;
  }

  return paddedFirstFraction > paddedSecondFraction ? 1 : -1;
};

// ============================================================
// TRANSACTION HISTORY QUERY SCHEMA
// ============================================================

/**
 * Validates query parameters for:
 *
 * GET /api/v1/transactions
 *
 * Supported query parameters:
 *
 * page       -> Positive integer; default 1
 * limit      -> Integer between 1 and 100; default 20
 * type       -> Valid TransactionType
 * status     -> Valid TransactionStatus
 * startDate  -> Valid YYYY-MM-DD date
 * endDate    -> Valid YYYY-MM-DD date
 * accountId  -> Valid UUID
 * minAmount  -> Non-negative decimal
 * maxAmount  -> Non-negative decimal
 *
 * Unknown query parameters are rejected.
 */
export const transactionHistoryQuerySchema = z
  .object({
    // --------------------------------------------------------
    // Pagination
    // --------------------------------------------------------

    page: z
      .string()
      .trim()
      .regex(
        /^[1-9]\d*$/,
        "Page must be a positive integer",
      )
      .transform(Number)
      .pipe(
        z
          .number()
          .int()
          .safe()
          .positive()
          .max(
            MAX_PAGE,
            "Page exceeds the supported maximum",
          ),
      )
      .optional()
      .default(DEFAULT_PAGE),

    limit: z
      .string()
      .trim()
      .regex(
        /^\d+$/,
        "Limit must be an integer",
      )
      .transform(Number)
      .pipe(
        z
          .number()
          .int()
          .min(1, "Limit must be at least 1")
          .max(
            MAX_LIMIT,
            `Limit cannot exceed ${MAX_LIMIT}`,
          ),
      )
      .optional()
      .default(DEFAULT_LIMIT),

    // --------------------------------------------------------
    // Transaction filters
    // --------------------------------------------------------

    type: z.nativeEnum(TransactionType).optional(),

    status: z.nativeEnum(TransactionStatus).optional(),

    // --------------------------------------------------------
    // Date filters
    // --------------------------------------------------------

    startDate: optionalDateSchema,

    endDate: optionalDateSchema,

    // --------------------------------------------------------
    // Account filter
    // --------------------------------------------------------

    accountId: z
      .string()
      .trim()
      .regex(
        UUID_PATTERN,
        "Account ID must be a valid UUID",
      )
      .optional(),

    // --------------------------------------------------------
    // Amount filters
    // --------------------------------------------------------

    minAmount: optionalAmountSchema,

    maxAmount: optionalAmountSchema,
  })
  .strict()
  .superRefine((query, context) => {
    // --------------------------------------------------------
    // Validate the date range
    // --------------------------------------------------------

    if (
      query.startDate !== undefined &&
      query.endDate !== undefined &&
      query.startDate > query.endDate
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message:
          "End date cannot be earlier than start date",
      });
    }

    // --------------------------------------------------------
    // Validate the amount range
    // --------------------------------------------------------

    if (
      query.minAmount !== undefined &&
      query.maxAmount !== undefined &&
      compareDecimals(query.minAmount, query.maxAmount) > 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxAmount"],
        message:
          "Maximum amount cannot be less than minimum amount",
      });
    }
  });

// ============================================================
// EXPORTED TYPES
// ============================================================

/**
 * TypeScript type inferred from the validated query schema.
 *
 * page and limit are numbers after validation.
 * Monetary amounts remain strings for decimal precision.
 */
export type TransactionHistoryQuery = z.infer<
  typeof transactionHistoryQuerySchema
>;