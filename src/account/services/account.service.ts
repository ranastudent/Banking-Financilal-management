import { randomInt } from "crypto";

import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type { AuthUser } from "../../types/auth";
import type { CreateAccountInput } from "../schemas/account.schema";

const MAX_ACCOUNT_NUMBER_ATTEMPTS = 5;

const generateAccountNumber = (): string => {
  /*
   * Generate a 16-digit account number.
   *
   * The number is represented as a string because account numbers
   * are identifiers, not values used for arithmetic.
   */
  const firstPart = randomInt(10_000_000, 100_000_000);
  const secondPart = randomInt(100_000_000, 1_000_000_000);

  return `${firstPart}${secondPart}`;
};

const createAccountRecord = async (
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  userId: string,
  input: CreateAccountInput,
) => {
  const user = await tx.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      id: true,
      role: true,
      status: true,
    },
  });

  if (!user) {
    throw new AppError(
      "User not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }

  if (user.role !== "CUSTOMER") {
    throw new AppError(
      "Only CUSTOMER users can create accounts",
      403,
      ErrorCode.FORBIDDEN,
    );
  }

  if (user.status !== "ACTIVE") {
    throw new AppError(
      "Only active users can create accounts",
      403,
      ErrorCode.FORBIDDEN,
    );
  }

  const currency = await tx.currency.findUnique({
    where: {
      code: input.currency,
    },
    select: {
      code: true,
      isActive: true,
    },
  });

  if (!currency) {
    throw new AppError(
      "Currency not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }

  if (!currency.isActive) {
    throw new AppError(
      "Currency is inactive",
      409,
      ErrorCode.CONFLICT,
    );
  }

  for (
    let attempt = 0;
    attempt < MAX_ACCOUNT_NUMBER_ATTEMPTS;
    attempt += 1
  ) {
    const accountNumber = generateAccountNumber();

    try {
      const account = await tx.account.create({
        data: {
          userId,
          accountNumber,
          accountType: input.accountType,
          status: "ACTIVE",

          balances: {
            create: {
              currencyCode: currency.code,
              availableBalance: 0,
              lockedBalance: 0,
            },
          },
        },
        select: {
          id: true,
          accountNumber: true,
          accountType: true,
          status: true,
          createdAt: true,
          updatedAt: true,

          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },

          balances: {
            select: {
              currencyCode: true,
              availableBalance: true,
              lockedBalance: true,
            },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: "ACCOUNT_CREATED",
          entityType: "ACCOUNT",
          entityId: account.id,
          description: `Account ${account.accountNumber} was created.`,
          metadata: {
            accountType: account.accountType,
            currency: currency.code,
          },
        },
      });

      return account;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "P2002"
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new AppError(
    "Unable to generate a unique account number",
    409,
    ErrorCode.CONFLICT,
  );
};

export const createCustomerAccount = async (
  user: AuthUser,
  input: CreateAccountInput,
) => {
  return prisma.$transaction((tx) =>
    createAccountRecord(tx, user.id, input),
  );
};