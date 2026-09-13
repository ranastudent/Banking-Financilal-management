import type { Request, Response } from "express";

import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type { BeneficiaryAssistanceParams } from "../schemas/beneficiary.schema";
import {
  getSupportCustomerBeneficiary,
} from "../services/beneficiary.service";

export const getCustomerBeneficiary = async (
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

  const params =
    req.validatedParams as BeneficiaryAssistanceParams;

  const beneficiary =
    await getSupportCustomerBeneficiary(
      req.user,
      params.customerId,
      params.beneficiaryId,
    );

  res.status(200).json({
    success: true,
    data: {
      beneficiary,
    },
    requestId: req.requestId,
  });
};