import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
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
  authorize("AUDITOR"),
  validate({
    query: auditorTransactionQuerySchema,
  }),
  getAuditorTransactionsController,
);

router.get(
  "/:transactionId",
  authenticate,
  authorize("AUDITOR"),
  validate({
    params: auditorTransactionParamsSchema,
  }),
  getAuditorTransactionController,
);

export default router;