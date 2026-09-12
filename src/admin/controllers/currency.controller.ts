import type { Request, Response } from "express";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import {
  changeAdminCurrencyStatus,
  getAdminCurrencyByCode,
  getAdminCurrencies,
} from "../services/currency.service";

export const getCurrencies = async (
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

  const result = await getAdminCurrencies(page, limit);

  res.status(200).json({
    success: true,
    data: result,
    requestId: req.requestId,
  });
};

export const getCurrency = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const rawCode = req.params.code;

  if (
    typeof rawCode !== "string" ||
    rawCode.trim() === ""
  ) {
    throw new AppError(
      "Currency code is required",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  const code = rawCode.trim().toUpperCase();

  if (!/^[A-Z]{3}$/.test(code)) {
    throw new AppError(
      "Currency code must be a valid 3-letter code",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  const currency = await getAdminCurrencyByCode(code);

  res.status(200).json({
    success: true,
    data: {
      currency,
    },
    requestId: req.requestId,
  });
};

export const changeCurrencyStatus = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const rawCode = req.params.code;

  if (
    typeof rawCode !== "string" ||
    rawCode.trim() === ""
  ) {
    throw new AppError(
      "Currency code is required",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  const code = rawCode.trim().toUpperCase();

  if (!/^[A-Z]{3}$/.test(code)) {
    throw new AppError(
      "Currency code must be a valid 3-letter code",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  const { isActive } = req.body as {
    isActive?: unknown;
  };

  if (typeof isActive !== "boolean") {
    throw new AppError(
      "isActive must be a boolean",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  if (!req.user) {
    throw new AppError(
      "Authentication required",
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }

  const ipAddress = req.ip;
  const userAgent = req.get("user-agent");

  const currency = await changeAdminCurrencyStatus(
    code,
    isActive,
    req.user.id,
    ipAddress,
    userAgent,
  );

  res.status(200).json({
    success: true,
    data: {
      currency,
    },
    requestId: req.requestId,
  });
};