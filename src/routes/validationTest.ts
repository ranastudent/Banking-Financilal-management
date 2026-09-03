import { Router } from "express";

import { validate } from "../middleware/validate";
import {accountNumberSchema,testValidationSchema, beneficiarySchema, paginationSchema,} from "../schemas/validation";
import { z } from "zod";
import { sendSuccess } from "../utils/apiResponse";
import { authRateLimiter, otpRateLimiter, } from "../middleware/rateLimiter";

const router = Router();

router.post(
  "/body",
  validate({
    body: testValidationSchema,
  }),
  (req, res) => {
    sendSuccess(res, req.requestId, req.body);
  },
);

router.post(
  "/beneficiary",
  validate({
    body: beneficiarySchema,
  }),
  (req, res) => {
    sendSuccess(res, req.requestId, req.body);
  },
);

router.get(
  "/pagination",
  validate({
    query: paginationSchema,
  }),
  (req, res) => {
    sendSuccess(res, req.requestId, req.validatedQuery);
  },
);

router.get(
  "/params/:accountNumber",
  validate({
    params: z.object({
      accountNumber: accountNumberSchema,
    }),
  }),
  (req, res) => {
    sendSuccess(res, req.requestId, req.params);
  },
);

router.post(
  "/auth-rate-limit",
  authRateLimiter,
  (_req, res) => {
    res.status(200).json({
      success: true,
      data: {
        message: "Authentication rate limit test passed",
      },
      requestId: _req.requestId,
    });
  },
);

router.post(
  "/otp-rate-limit",
  otpRateLimiter,
  (req, res) => {
    res.status(200).json({
      success: true,
      data: {
        message: "OTP rate limit test passed",
      },
      requestId: req.requestId,
    });
  },
);

export default router;