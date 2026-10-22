import { TransactionStatus, TransactionType } from "@prisma/client";
import { z } from "zod";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL_PATTERN = /^\d+(\.\d{1,8})?$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_PAGE = 2_147_483_647;
const MAX_CURSOR_LENGTH = 512;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_INTEGER_DIGITS = 16;
const MAX_DECIMAL_PLACES = 8;

const optionalDateSchema = z
  .string()
  .trim()
  .regex(DATE_PATTERN, "Date must use YYYY-MM-DD format")
  .refine(
    (value) => {
      const date = new Date(`${value}T00:00:00.000Z`);

      return (
        !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
      );
    },
    { message: "Date must be a valid calendar date" },
  )
  .optional();

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
    { message: "Amount exceeds the supported precision" },
  )
  .optional();

const normalizeDecimal = (value: string): string => {
  const [integerPart = "0", fractionalPart = ""] = value.split(".");
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, "");
  const normalizedFraction = fractionalPart.replace(/0+$/, "");

  return normalizedFraction.length === 0
    ? normalizedInteger
    : `${normalizedInteger}.${normalizedFraction}`;
};

const compareDecimals = (first: string, second: string): number => {
  const normalizedFirst = normalizeDecimal(first);
  const normalizedSecond = normalizeDecimal(second);

  const [firstInteger = "0", firstFraction = ""] =
    normalizedFirst.split(".");
  const [secondInteger = "0", secondFraction = ""] =
    normalizedSecond.split(".");

  if (firstInteger.length !== secondInteger.length) {
    return firstInteger.length > secondInteger.length ? 1 : -1;
  }

  if (firstInteger !== secondInteger) {
    return firstInteger > secondInteger ? 1 : -1;
  }

  const fractionLength = Math.max(
    firstFraction.length,
    secondFraction.length,
  );

  const paddedFirstFraction = firstFraction.padEnd(fractionLength, "0");
  const paddedSecondFraction = secondFraction.padEnd(fractionLength, "0");

  if (paddedFirstFraction === paddedSecondFraction) {
    return 0;
  }

  return paddedFirstFraction > paddedSecondFraction ? 1 : -1;
};

export type TransactionPaginationMode = "offset" | "cursor";

export const getTransactionPaginationMode = (
  rawQuery: unknown,
): TransactionPaginationMode => {
  if (
    typeof rawQuery !== "object" ||
    rawQuery === null ||
    Array.isArray(rawQuery)
  ) {
    return "cursor";
  }

  const query = rawQuery as Record<string, unknown>;
  const hasExplicitPage = query.page !== undefined;
  const hasCursor = query.cursor !== undefined;

  if (hasExplicitPage && hasCursor) {
    throw new AppError(
      "Cursor pagination cannot be combined with page pagination",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  return hasExplicitPage ? "offset" : "cursor";
};

const transactionHistoryQueryObjectSchema = z
  .object({
    page: z
      .string()
      .trim()
      .regex(/^[1-9]\d*$/, "Page must be a positive integer")
      .transform(Number)
      .pipe(
        z
          .number()
          .int()
          .safe()
          .positive()
          .max(MAX_PAGE, "Page exceeds the supported maximum"),
      )
      .optional()
      .default(DEFAULT_PAGE),

    limit: z
      .string()
      .trim()
      .regex(/^\d+$/, "Limit must be an integer")
      .transform(Number)
      .pipe(
        z
          .number()
          .int()
          .min(1, "Limit must be at least 1")
          .max(MAX_LIMIT, `Limit cannot exceed ${MAX_LIMIT}`),
      )
      .optional()
      .default(DEFAULT_LIMIT),

    cursor: z
      .string()
      .trim()
      .min(1, "Cursor cannot be empty")
      .max(
        MAX_CURSOR_LENGTH,
        `Cursor cannot exceed ${MAX_CURSOR_LENGTH} characters`,
      )
      .regex(CURSOR_PATTERN, "Cursor must be a valid Base64URL token")
      .optional(),

    type: z.nativeEnum(TransactionType).optional(),
    status: z.nativeEnum(TransactionStatus).optional(),
    startDate: optionalDateSchema,
    endDate: optionalDateSchema,

    accountId: z
      .string()
      .trim()
      .regex(UUID_PATTERN, "Account ID must be a valid UUID")
      .optional(),

    minAmount: optionalAmountSchema,
    maxAmount: optionalAmountSchema,
  })
  .strict();

export const transactionHistoryQuerySchema = z
  .preprocess(
    (input, context) => {
      if (
        typeof input !== "object" ||
        input === null ||
        Array.isArray(input)
      ) {
        return input;
      }

      const rawQuery = input as Record<string, unknown>;

      if (
        rawQuery.page !== undefined &&
        rawQuery.cursor !== undefined
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cursor"],
          message:
            "Cursor pagination cannot be combined with page pagination",
        });

        return z.NEVER;
      }

      return rawQuery;
    },
    transactionHistoryQueryObjectSchema,
  )
  .superRefine((query, context) => {
    if (
      query.startDate !== undefined &&
      query.endDate !== undefined &&
      query.startDate > query.endDate
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "End date cannot be earlier than start date",
      });
    }

    if (
      query.minAmount !== undefined &&
      query.maxAmount !== undefined &&
      compareDecimals(query.minAmount, query.maxAmount) > 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxAmount"],
        message: "Maximum amount cannot be less than minimum amount",
      });
    }
  });

export type TransactionHistoryQuery = z.infer<
  typeof transactionHistoryQuerySchema
>;