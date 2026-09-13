import type { Request, Response } from "express";

import { AppError } from "../../errors/AppError";
import { ErrorCode } from "../../errors/errorCodes";
import type { CustomerLookupQuery } from "../schemas/customer.schema";
import { lookupCustomers } from "../services/customer.service";

export const lookupCustomersController = async (
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

  const query =
    req.validatedQuery as CustomerLookupQuery;

  const result = await lookupCustomers(
    req.user,
    query.q,
    query.page,
    query.limit,
  );

  res.status(200).json({
    success: true,
    data: result,
    requestId: req.requestId,
  });
};