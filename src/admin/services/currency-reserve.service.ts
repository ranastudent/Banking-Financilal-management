import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import { Prisma } from "@prisma/client";
import type { AdjustCurrencyReserveInput } from "../schemas/currency-reserve.schema";

const SAFE_CURRENCY_RESERVE_SELECT = {
  id: true,
  currencyCode: true,
  availableReserve: true,
  lockedReserve: true,
  minimumReserve: true,
  createdAt: true,
  updatedAt: true,
  currency: {
    select: {
      code: true,
      name: true,
      symbol: true,
      decimalPlaces: true,
      isActive: true,
    },
  },
} as const;

export const getAdminCurrencyReserves = async (
  page: number,
  limit: number,
) => {
  const skip = (page - 1) * limit;

  const [reserves, total] = await prisma.$transaction([
    prisma.currencyReserve.findMany({
      skip,
      take: limit,
      orderBy: {
        currencyCode: "asc",
      },
      select: SAFE_CURRENCY_RESERVE_SELECT,
    }),

    prisma.currencyReserve.count(),
  ]);

  return {
    reserves,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const getAdminCurrencyReserveByCurrency = async (
  currencyCode: string,
) => {
  const reserve = await prisma.currencyReserve.findUnique({
    where: {
      currencyCode,
    },
    select: SAFE_CURRENCY_RESERVE_SELECT,
  });

  if (!reserve) {
    throw new AppError(
      "Currency reserve not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }

  return reserve;
};

export const adjustAdminCurrencyReserve = async (
  currencyCode: string,
  input: AdjustCurrencyReserveInput,
  adminUserId: string,
  ipAddress?: string,
  userAgent?: string,
) => {
  return prisma.$transaction(async (tx) => {
    /*
     * Lock the reserve row for the duration of this transaction.
     *
     * This prevents two concurrent ADMIN adjustments from both
     * reading the same balance and producing an incorrect result.
     */
    const reserves = await tx.$queryRaw<
      Array<{
        id: string;
        currency_code: string;
        available_reserve: Prisma.Decimal;
        locked_reserve: Prisma.Decimal;
        minimum_reserve: Prisma.Decimal;
      }>
    >`
      SELECT
        id,
        currency_code,
        available_reserve,
        locked_reserve,
        minimum_reserve
      FROM currency_reserves
      WHERE currency_code = ${currencyCode}
      FOR UPDATE
    `;

    const reserve = reserves[0];

    if (!reserve) {
      throw new AppError(
        "Currency reserve not found",
        404,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    const adjustmentAmount = new Prisma.Decimal(input.amount);

    const balanceBefore = reserve.available_reserve;

    const balanceAfter =
      input.direction === "INCREASE"
        ? balanceBefore.add(adjustmentAmount)
        : balanceBefore.sub(adjustmentAmount);

    if (input.direction === "DECREASE") {
      if (balanceAfter.isNegative()) {
        throw new AppError(
          "Reserve cannot become negative",
          409,
          ErrorCode.CONFLICT,
        );
      }

      if (balanceAfter.lessThan(reserve.minimum_reserve)) {
        throw new AppError(
          "Reserve adjustment would violate the minimum reserve requirement",
          409,
          ErrorCode.CONFLICT,
        );
      }
    }

    const updatedReserve = await tx.currencyReserve.update({
      where: {
        id: reserve.id,
      },
      data: {
        availableReserve: balanceAfter,
      },
      select: SAFE_CURRENCY_RESERVE_SELECT,
    });

    await tx.reserveMovement.create({
      data: {
        reserveId: reserve.id,
        currencyCode: currencyCode,
        movementType: "ADMIN_ADJUSTMENT",
        amount: adjustmentAmount,
        balanceBefore,
        balanceAfter,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: adminUserId,
        action: "CURRENCY_RESERVE_ADJUSTED",
        entityType: "CURRENCY_RESERVE",
        entityId: reserve.id,
        description: `Currency reserve ${currencyCode} was ${input.direction === "INCREASE" ? "increased" : "decreased"} by ${input.amount}.`,
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
        metadata: {
          currencyCode,
          amount: input.amount,
          direction: input.direction,
          reason: input.reason,
          balanceBefore: balanceBefore.toString(),
          balanceAfter: balanceAfter.toString(),
          minimumReserve: reserve.minimum_reserve.toString(),
        },
      },
    });

    return updatedReserve;
  });
};