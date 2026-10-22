import type { Request, Response } from "express";
import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import {
  createBeneficiary as createBeneficiaryService,
  deleteBeneficiary as deleteBeneficiaryService,
  listBeneficiaries as listBeneficiariesService,
  authorizeBeneficiaryView,
  updateBeneficiary as updateBeneficiaryService,
} from "../services/beneficiary.service";
import type {
  BeneficiaryIdParams,
  CreateBeneficiaryInput,
  ListBeneficiariesQuery,
  UpdateBeneficiaryInput,
} from "../schemas/beneficiary.schema";

const requireAuthenticatedUser = (req: Request) => {
  if (!req.user) {
    throw new AppError(
      "Authentication required",
      401,
      ErrorCode.UNAUTHORIZED,
    );
  }

  return req.user;
};

export const createBeneficiary = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const user = requireAuthenticatedUser(req);
  const input = req.body as CreateBeneficiaryInput;
  const beneficiary = await createBeneficiaryService(user, input);

  res.status(201).json({
    success: true,
    data: { beneficiary },
    requestId: req.requestId,
  });
};

export const listBeneficiaries = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const user = requireAuthenticatedUser(req);
  const query = req.validatedQuery as ListBeneficiariesQuery;
  const result = await listBeneficiariesService(user.id, query);

  res.status(200).json({
    success: true,
    data: result,
    requestId: req.requestId,
  });
};

export const updateBeneficiary = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const user = requireAuthenticatedUser(req);
  const params = req.validatedParams as BeneficiaryIdParams;
  const input = req.body as UpdateBeneficiaryInput;
  const beneficiary = await updateBeneficiaryService(
    user.id,
    params.beneficiaryId,
    input,
  );

  res.status(200).json({
    success: true,
    data: { beneficiary },
    requestId: req.requestId,
  });
};

export const deleteBeneficiary = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const user = requireAuthenticatedUser(req);
  const params = req.validatedParams as BeneficiaryIdParams;

  await deleteBeneficiaryService(user.id, params.beneficiaryId);

  res.status(200).json({
    success: true,
    data: {
      id: params.beneficiaryId,
      deleted: true,
    },
    requestId: req.requestId,
  });
};

export const getBeneficiary = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const user = requireAuthenticatedUser(req);
  const beneficiaryId = req.params.beneficiaryId;

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
    user.id,
    user.role,
  );

  res.status(200).json({
    success: true,
    data: { beneficiary },
    requestId: req.requestId,
  });
};
