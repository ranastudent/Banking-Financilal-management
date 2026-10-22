import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { transactionHistoryRateLimiter } from "../../middleware/rateLimiter";
import { authorize } from "../../middleware/authorize";
import {
  getTransaction,
  getTransactions,
} from "../controllers/transaction.controller";

const router = Router();

router.get(
  "/",
  authenticate,
  transactionHistoryRateLimiter,
  authorize("ADMIN"),
  getTransactions,
);

router.get(
  "/:transactionId",
  authenticate,
  transactionHistoryRateLimiter,
  authorize("ADMIN"),
  getTransaction,
);

export default router;