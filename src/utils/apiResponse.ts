import { Response } from "express";
import { ApiSuccessResponse } from "../types/apiResponse";

export const sendSuccess = <T>(
  res: Response,
  requestId: string,
  data: T,
  statusCode = 200,
): Response<ApiSuccessResponse<T>> => {
  return res.status(statusCode).json({
    success: true,
    data,
    requestId,
  });
};