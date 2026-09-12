import type { Request, Response } from "express";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import {
  getAdminExchangeRateById,
  getAdminExchangeRates,
} from "../services/exchange-rate.service";
import { createExchangeRateSchema } from "../schemas/exchange-rate.schema";
import { createAdminExchangeRate } from "../services/exchange-rate.service";

export const createExchangeRate = async (
  req: Request,
  res: Response,
): Promise<void> => {
  if (!req.user) {
    throw new AppError(
      "Authentication required",
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }

  const parsed = createExchangeRateSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError(
      parsed.error.issues[0]?.message ?? "Invalid exchange-rate data",
      400,
      ErrorCode.VALIDATION_ERROR,
    );
  }

  const exchangeRate = await createAdminExchangeRate(
    parsed.data,
    req.user.id,
    req.ip,
    req.get("user-agent"),
  );

  res.status(201).json({
    success: true,
    data: {
      exchangeRate,
    },
    requestId: req.requestId,
  });
};

export const getExchangeRates = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const rawPage = req.query.page;
  const rawLimit = req.query.limit;

  const page =
    typeof rawPage === "string" && rawPage.trim() !== ""
      ? Number(rawPage)
      : 1;

  const limit =
    typeof rawLimit === "string" && rawLimit.trim() !== ""
      ? Number(rawLimit)
      : 20;

  if (!Number.isInteger(page) || page < 1) {
    throw new AppError(
      "Page must be a positive integer",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new AppError(
      "Limit must be between 1 and 100",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  const result = await getAdminExchangeRates(page, limit);

  res.status(200).json({
    success: true,
    data: result,
    requestId: req.requestId,
  });
};

export const getExchangeRate = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const exchangeRateId = req.params.exchangeRateId;

  if (
    typeof exchangeRateId !== "string" ||
    exchangeRateId.trim() === ""
  ) {
    throw new AppError(
      "Exchange rate ID is required",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  const exchangeRate =
    await getAdminExchangeRateById(exchangeRateId);

  res.status(200).json({
    success: true,
    data: {
      exchangeRate,
    },
    requestId: req.requestId,
  });
};