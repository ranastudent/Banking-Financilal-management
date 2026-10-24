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
  // Keep service-level invariants even when this function is called
  // outside the HTTP/Zod validation path.
  const baseCurrencyCode = input.baseCurrency.trim().toUpperCase();
  const quoteCurrencyCode = input.quoteCurrency.trim().toUpperCase();

  if (baseCurrencyCode.length !== 3 || quoteCurrencyCode.length !== 3) {
    throw new AppError(
      "Currency codes must contain exactly three letters",
      400,
      ErrorCode.VALIDATION_ERROR,
    );
  }

  if (baseCurrencyCode === quoteCurrencyCode) {
    throw new AppError(
      "Base and quote currencies must be different",
      400,
      ErrorCode.VALIDATION_ERROR,
    );
  }

  if (!Number.isFinite(input.rate) || input.rate <= 0) {
    throw new AppError("Rate must be greater than zero", 400, ErrorCode.VALIDATION_ERROR);
  }

  if (input.buyRate !== undefined &&
      (!Number.isFinite(input.buyRate) || input.buyRate <= 0 || input.buyRate > input.rate)) {
    throw new AppError("buyRate must be positive and cannot exceed rate", 400, ErrorCode.VALIDATION_ERROR);
  }

  if (input.sellRate !== undefined &&
      (!Number.isFinite(input.sellRate) || input.sellRate <= 0 || input.sellRate < input.rate)) {
    throw new AppError("sellRate must be positive and cannot be lower than rate", 400, ErrorCode.VALIDATION_ERROR);
  }

  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new AppError("Version must be a positive integer", 400, ErrorCode.VALIDATION_ERROR);
  }

  if (!(input.effectiveFrom instanceof Date) || Number.isNaN(input.effectiveFrom.getTime())) {
    throw new AppError("effectiveFrom must be a valid date", 400, ErrorCode.VALIDATION_ERROR);
  }

  if (input.effectiveTo && (
    Number.isNaN(input.effectiveTo.getTime()) ||
    input.effectiveTo <= input.effectiveFrom
  )) {
    throw new AppError("effectiveTo must be later than effectiveFrom", 400, ErrorCode.VALIDATION_ERROR);
  }

  const normalizedInput: CreateExchangeRateInput = {
    ...input,
    baseCurrency: baseCurrencyCode,
    quoteCurrency: quoteCurrencyCode,
  };

  try {
    return await prisma.$transaction(async (tx) => {
    const baseCurrency = await tx.currency.findUnique({
      where: {
        code: normalizedInput.baseCurrency,
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
        code: normalizedInput.quoteCurrency,
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
          baseCurrency: normalizedInput.baseCurrency,
          quoteCurrency: normalizedInput.quoteCurrency,
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
          baseCurrency: normalizedInput.baseCurrency,
          quoteCurrency: normalizedInput.quoteCurrency,
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
        baseCurrency: normalizedInput.baseCurrency,
        quoteCurrency: normalizedInput.quoteCurrency,
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
        description: `Exchange rate ${normalizedInput.baseCurrency}/${normalizedInput.quoteCurrency} version ${input.version} was created with status ${input.status}.`,
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
        metadata: {
          baseCurrency: normalizedInput.baseCurrency,
          quoteCurrency: normalizedInput.quoteCurrency,
          version: input.version,
          rate: input.rate,
          status: input.status,
        },
      },
    });

    return exchangeRate;
    });
  } catch (error) {
    // A concurrent request can pass the pre-check and hit the unique
    // constraint. Return a stable conflict instead of a generic 500.
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2002"
    ) {
      throw new AppError(
        "Exchange rate version already exists for this currency pair",
        409,
        ErrorCode.CONFLICT,
      );
    }
    throw error;
  }
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

