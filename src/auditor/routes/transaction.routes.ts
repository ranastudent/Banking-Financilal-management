import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
import { transactionHistoryRateLimiter } from "../../middleware/rateLimiter";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";

import {
  getAuditorTransactionController,
  getAuditorTransactionsController,
} from "../controllers/transaction.controller";

import {
  auditorTransactionParamsSchema,
  auditorTransactionQuerySchema,
} from "../schemas/transaction.schema";

const router = Router();

router.get(
  "/",
  authenticate,
  transactionHistoryRateLimiter,
  authorize("AUDITOR"),
  validate({
    query: auditorTransactionQuerySchema,
  }),
  getAuditorTransactionsController,
);

router.get(
  "/:transactionId",
  authenticate,
  transactionHistoryRateLimiter,
  authorize("AUDITOR"),
  validate({
    params: auditorTransactionParamsSchema,
  }),
  getAuditorTransactionController,
);

export default router;