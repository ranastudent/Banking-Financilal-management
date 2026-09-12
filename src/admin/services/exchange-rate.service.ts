import { prisma } from "../../config/prisma";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type { CreateExchangeRateInput } from "../schemas/exchange-rate.schema";

export const createAdminExchangeRate = async (
  input: CreateExchangeRateInput,
  adminUserId: string,
  ipAddress?: string,
  userAgent?: string,
) => {
  return prisma.$transaction(async (tx) => {
    const baseCurrency = await tx.currency.findUnique({
      where: {
        code: input.baseCurrency,
      },
      select: {
        code: true,
        isActive: true,
      },
    });

    if (!baseCurrency) {
      throw new AppError(
        "Base currency not found",
        404,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    if (!baseCurrency.isActive) {
      throw new AppError(
        "Base currency is inactive",
        409,
        ErrorCode.CONFLICT,
      );
    }

    const quoteCurrency = await tx.currency.findUnique({
      where: {
        code: input.quoteCurrency,
      },
      select: {
        code: true,
        isActive: true,
      },
    });

    if (!quoteCurrency) {
      throw new AppError(
        "Quote currency not found",
        404,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    if (!quoteCurrency.isActive) {
      throw new AppError(
        "Quote currency is inactive",
        409,
        ErrorCode.CONFLICT,
      );
    }

    const existingVersion = await tx.exchangeRate.findUnique({
      where: {
        baseCurrency_quoteCurrency_version: {
          baseCurrency: input.baseCurrency,
          quoteCurrency: input.quoteCurrency,
          version: input.version,
        },
      },
      select: {
        id: true,
      },
    });

    if (existingVersion) {
      throw new AppError(
        "Exchange rate version already exists for this currency pair",
        409,
        ErrorCode.CONFLICT,
      );
    }

    if (input.status === "ACTIVE") {
      await tx.exchangeRate.updateMany({
        where: {
          baseCurrency: input.baseCurrency,
          quoteCurrency: input.quoteCurrency,
          status: "ACTIVE",
        },
        data: {
          status: "INACTIVE",
          effectiveTo: input.effectiveFrom,
        },
      });
    }

    const exchangeRate = await tx.exchangeRate.create({
      data: {
        baseCurrency: input.baseCurrency,
        quoteCurrency: input.quoteCurrency,
        rate: input.rate,
        ...(input.buyRate !== undefined
            ? { buyRate: input.buyRate }
            : {}),
        ...(input.sellRate !== undefined
            ? { sellRate: input.sellRate }
            : {}),
        ...(input.spread !== undefined
            ? { spread: input.spread }
            : {}),
        ...(input.source !== undefined
            ? { source: input.source }
            : {}),
        version: input.version,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        status: input.status,
    },
      select: SAFE_EXCHANGE_RATE_SELECT,
    });

    await tx.auditLog.create({
      data: {
        userId: adminUserId,
        action: "EXCHANGE_RATE_CREATED",
        entityType: "EXCHANGE_RATE",
        entityId: exchangeRate.id,
        description: `Exchange rate ${input.baseCurrency}/${input.quoteCurrency} version ${input.version} was created with status ${input.status}.`,
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
        metadata: {
          baseCurrency: input.baseCurrency,
          quoteCurrency: input.quoteCurrency,
          version: input.version,
          rate: input.rate,
          status: input.status,
        },
      },
    });

    return exchangeRate;
  });
};

const SAFE_EXCHANGE_RATE_SELECT = {
  id: true,
  baseCurrency: true,
  quoteCurrency: true,
  rate: true,
  buyRate: true,
  sellRate: true,
  spread: true,
  source: true,
  version: true,
  effectiveFrom: true,
  effectiveTo: true,
  status: true,
  createdAt: true,
  baseCurrencyRef: {
    select: {
      code: true,
      name: true,
      symbol: true,
      decimalPlaces: true,
    },
  },
  quoteCurrencyRef: {
    select: {
      code: true,
      name: true,
      symbol: true,
      decimalPlaces: true,
    },
  },
} as const;

export const getAdminExchangeRates = async (
  page: number,
  limit: number,
) => {
  const skip = (page - 1) * limit;

  const [exchangeRates, total] = await prisma.$transaction([
    prisma.exchangeRate.findMany({
      skip,
      take: limit,
      orderBy: [
        {
          createdAt: "desc",
        },
        {
          version: "desc",
        },
      ],
      select: SAFE_EXCHANGE_RATE_SELECT,
    }),

    prisma.exchangeRate.count(),
  ]);

  return {
    exchangeRates,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const getAdminExchangeRateById = async (
  exchangeRateId: string,
) => {
  const exchangeRate = await prisma.exchangeRate.findUnique({
    where: {
      id: exchangeRateId,
    },
    select: SAFE_EXCHANGE_RATE_SELECT,
  });

  if (!exchangeRate) {
    throw new AppError(
      "Exchange rate not found",
      404,
      ErrorCode.RESOURCE_NOT_FOUND,
    );
  }

  return exchangeRate;
};

