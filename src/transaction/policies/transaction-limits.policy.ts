import { Prisma } from "@prisma/client";

import { env } from "../../config/env";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";

/**
 * Validate the configured single-transfer floor and ceiling using Decimal
 * arithmetic so financial values are never compared as binary floats.
 */
export const assertTransferAmountWithinLimits = (
  amount: Prisma.Decimal,
): void => {
  const minimum = new Prisma.Decimal(
    env.transactionLimits.transferMinAmount,
  );
  const maximum = new Prisma.Decimal(
    env.transactionLimits.transferMaxAmount,
  );

  if (!amount.isFinite() || amount.lte(0)) {
    throw new AppError(
      "Transfer amount must be greater than zero",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  if (amount.lt(minimum)) {
    throw new AppError(
      `Transfer amount must be at least ${minimum.toString()}`,
      409,
      ErrorCode.TRANSACTION_LIMIT_EXCEEDED,
    );
  }

  if (amount.gt(maximum)) {
    throw new AppError(
      `Transfer amount exceeds the maximum single-transfer limit of ${maximum.toString()}`,
      409,
      ErrorCode.TRANSACTION_LIMIT_EXCEEDED,
    );
  }
};

/**
 * Convert a wall-clock time in an IANA timezone to a UTC instant. Iterative
 * offset resolution avoids relying on the server's local timezone.
 */
const zonedMidnightToUtc = (
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date => {
  let guess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  for (let iteration = 0; iteration < 4; iteration += 1) {
    const parts = formatter.formatToParts(guess);
    const values = Object.fromEntries(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    ) as Record<string, number>;

    // formatToParts is typed as an open-ended collection, so guard required
    // numeric parts before passing them to Date.UTC under strict TypeScript.
    const year = values.year;
    const month = values.month;
    const day = values.day;
    const hour = values.hour;
    const minute = values.minute;
    const second = values.second;
    if (
      year === undefined ||
      month === undefined ||
      day === undefined ||
      hour === undefined ||
      minute === undefined ||
      second === undefined
    ) {
      throw new Error(`Unable to resolve local time parts for timezone ${timeZone}`);
    }

    const representedAsUtc = Date.UTC(
      year,
      month - 1,
      day,
      hour,
      minute,
      second,
    );
    const desiredAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
    const adjustment = desiredAsUtc - representedAsUtc;

    if (adjustment === 0) break;
    guess = new Date(guess.getTime() + adjustment);
  }

  return guess;
};

export type DailyWindow = {
  start: Date;
  end: Date;
};

/** Return [start, end) for the calendar day in the configured timezone. */
export const getDailyWindow = (
  instant: Date = new Date(),
  timeZone: string = env.transactionLimits.timeZone,
): DailyWindow => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;

  const year = parts.year;
  const month = parts.month;
  const day = parts.day;
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Unable to resolve calendar date for timezone ${timeZone}`);
  }

  const nextDate = new Date(Date.UTC(year, month - 1, day + 1));

  return {
    start: zonedMidnightToUtc(year, month, day, timeZone),
    end: zonedMidnightToUtc(
      nextDate.getUTCFullYear(),
      nextDate.getUTCMonth() + 1,
      nextDate.getUTCDate(),
      timeZone,
    ),
  };
};
