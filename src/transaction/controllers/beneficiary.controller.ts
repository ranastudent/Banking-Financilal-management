import type { Request, Response } from "express";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import { authorizeBeneficiaryView } from "../services/beneficiary.service";

export const getBeneficiary = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const beneficiaryId = req.params.beneficiaryId;

  if (!req.user) {
    throw new AppError(
      "Authentication required",
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }

  if (
    typeof beneficiaryId !== "string" ||
    beneficiaryId.trim() === ""
  ) {
    throw new AppError(
      "Beneficiary ID is required",
      400,
      ErrorCode.BAD_REQUEST,
    );
  }

  const beneficiary = await authorizeBeneficiaryView(
    beneficiaryId,
    req.user.id,
    req.user.role,
  );

  res.status(200).json({
    success: true,
    data: {
      beneficiary,
    },
    requestId: req.requestId,
  });
};