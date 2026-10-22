import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
import { transactionHistoryRateLimiter } from "../../middleware/rateLimiter";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";

import {
  getCustomerTransactions,
} from "../controllers/transaction.controller";

import {
  customerTransactionParamsSchema,
  customerTransactionQuerySchema,
} from "../schemas/transaction.schema";

const router = Router();

router.get(
  "/:customerId/transactions",
  authenticate,
  transactionHistoryRateLimiter,
  authorize("SUPPORT"),
  validate({
    params: customerTransactionParamsSchema,
    query: customerTransactionQuerySchema,
  }),
  getCustomerTransactions,
);

export default router;