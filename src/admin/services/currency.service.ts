import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";

const SAFE_CURRENCY_SELECT = {
  code: true,
  name: true,
  symbol: true,
  decimalPlaces: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const getAdminCurrencies = async (
  page: number,
  limit: number,
) => {
  const skip = (page - 1) * limit;

  const [currencies, total] = await prisma.$transaction([
    prisma.currency.findMany({
      skip,
      take: limit,
      orderBy: {
        code: "asc",
      },
      select: SAFE_CURRENCY_SELECT,
    }),

    prisma.currency.count(),
  ]);

  return {
    currencies,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const getAdminCurrencyByCode = async (
  code: string,
) => {
  const currency = await prisma.currency.findUnique({
    where: {
      code,
    },
    select: SAFE_CURRENCY_SELECT,
  });

  if (!currency) {
    throw new AppError(
      "Currency not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }

  return currency;
};

export const changeAdminCurrencyStatus = async (
  code: string,
  isActive: boolean,
  adminUserId: string,
  ipAddress: string | undefined,
  userAgent: string | undefined,
) => {
  return prisma.$transaction(async (tx) => {
    const currency = await tx.currency.findUnique({
      where: {
        code,
      },
      select: {
        code: true,
        name: true,
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

    if (currency.isActive === isActive) {
      throw new AppError(
        `Currency is already ${
          isActive ? "active" : "inactive"
        }`,
        409,
        ErrorCode.CONFLICT,
      );
    }

    /*
     * Deactivation safety checks.
     *
     * A currency must not be disabled while it is still
     * actively used by financial records.
     */
    if (!isActive) {
      const activeExchangeRate = await tx.exchangeRate.findFirst({
        where: {
          status: "ACTIVE",
          OR: [
            {
              baseCurrency: code,
            },
            {
              quoteCurrency: code,
            },
          ],
        },
        select: {
          id: true,
        },
      });

      if (activeExchangeRate) {
        throw new AppError(
          "Currency cannot be deactivated while active exchange rates exist",
          409,
          ErrorCode.CONFLICT,
        );
      }

      const nonZeroBalance = await tx.accountBalance.findFirst({
        where: {
          currencyCode: code,
          OR: [
            {
              availableBalance: {
                gt: 0,
              },
            },
            {
              lockedBalance: {
                gt: 0,
              },
            },
          ],
        },
        select: {
          id: true,
        },
      });

      if (nonZeroBalance) {
        throw new AppError(
          "Currency cannot be deactivated while customer balances exist",
          409,
          ErrorCode.CONFLICT,
        );
      }

      const reserve = await tx.currencyReserve.findUnique({
        where: {
          currencyCode: code,
        },
        select: {
          availableReserve: true,
          lockedReserve: true,
        },
      });

      if (
        reserve &&
        (reserve.availableReserve.gt(0) ||
          reserve.lockedReserve.gt(0))
      ) {
        throw new AppError(
          "Currency cannot be deactivated while reserve funds exist",
          409,
          ErrorCode.CONFLICT,
        );
      }
    }

    const updatedCurrency = await tx.currency.update({
      where: {
        code,
      },
      data: {
        isActive,
      },
      select: SAFE_CURRENCY_SELECT,
    });

    await tx.auditLog.create({
    data: {
        userId: adminUserId,
        action: "CURRENCY_STATUS_CHANGED",
        entityType: "CURRENCY",
        entityId: currency.code,
        description: `Currency ${currency.code} status changed from ${
        currency.isActive ? "active" : "inactive"
        } to ${isActive ? "active" : "inactive"}.`,
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
        metadata: {
        previousIsActive: currency.isActive,
        newIsActive: isActive,
        },
    },
    });

    return updatedCurrency;
  });
};