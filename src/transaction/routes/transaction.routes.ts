import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";

import {
  authorizeDeposit,
} from "../controllers/deposit.controller";

import {
  processWithdrawal,
} from "../controllers/withdrawal.controller";

import {
  transferAuthorizationController,
} from "../controllers/transfer.controller";

import {
  getTransaction,
} from "../controllers/transaction.controller";

import {
  getTransactionHistoryController,
} from "../controllers/transaction-history.controller";

import {
  transactionHistoryQuerySchema,
} from "../validation/transaction-history-query";

const router = Router();

// ============================================================
// TRANSACTION HISTORY
// ============================================================

/**
 * GET /
 *
 * Retrieves paginated transaction history for the authenticated
 * user, subject to role-based authorization and account ownership.
 *
 * Query parameters:
 * page, limit, type, status, startDate, endDate,
 * accountId, minAmount, maxAmount
 */
router.get(
  "/",
  authenticate,
  authorize("CUSTOMER", "ADMIN", "SUPPORT", "AUDITOR"),
  validate({
    query: transactionHistoryQuerySchema,
  }),
  getTransactionHistoryController,
);

// ============================================================
// DEPOSIT
// ============================================================

router.post(
  "/deposit/:accountId",
  authenticate,
  authorize("CUSTOMER", "ADMIN"),
  authorizeDeposit,
);

// ============================================================
// WITHDRAWAL
// ============================================================

router.post(
  "/withdrawal/:accountId",
  authenticate,
  authorize("CUSTOMER", "ADMIN"),
  processWithdrawal,
);

// ============================================================
// INTERNAL TRANSFER
// ============================================================

router.post(
  "/transfer/:sourceAccountId/:destinationAccountId",
  authenticate,
  authorize("CUSTOMER", "ADMIN"),
  transferAuthorizationController,
);

// ============================================================
// SINGLE TRANSACTION
// ============================================================

router.get(
  "/:transactionId",
  authenticate,
  authorize("CUSTOMER", "ADMIN", "SUPPORT", "AUDITOR"),
  getTransaction,
);

export default router;