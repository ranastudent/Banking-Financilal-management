import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";
import { requireIdempotencyKey } from "../../middleware/idempotency.middleware";
import { withdrawalSchema } from "../../account/schemas/withdrawal.schema";
import {
  transferRateLimiter,
  transactionHistoryRateLimiter,
} from "../../middleware/rateLimiter";

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
  transactionHistoryRateLimiter,
  authorize("CUSTOMER", "ADMIN", "SUPPORT", "AUDITOR"),
  validate({
    query: transactionHistoryQuerySchema,
  }),
  getTransactionHistoryController,
);

// ============================================================
// LEGACY DEPOSIT AUTHORIZATION (does not execute a deposit)
// Use POST /api/v1/accounts/:accountId/deposits to execute a deposit.
// ============================================================

router.post(
  "/deposit/:accountId",
  authenticate,
  authorize("CUSTOMER", "ADMIN"),
  authorizeDeposit,
);

// ============================================================
// LEGACY WITHDRAWAL EXECUTION
// Kept for backward compatibility; now enforces schema validation and idempotency.
// Prefer POST /api/v1/accounts/:accountId/withdrawals for new clients.
// ============================================================

router.post(
  "/withdrawal/:accountId",
  authenticate,
  authorize("CUSTOMER", "ADMIN"),
  validate({ body: withdrawalSchema }),
  requireIdempotencyKey,
  processWithdrawal,
);

// ============================================================
// LEGACY TRANSFER AUTHORIZATION (does not execute a transfer)
// Use POST /api/v1/transfers to execute a fund transfer.
// ============================================================

router.post(
  "/transfer/:sourceAccountId/:destinationAccountId",
  authenticate,
  transferRateLimiter,
  authorize("CUSTOMER", "ADMIN"),
  transferAuthorizationController,
);

// ============================================================
// SINGLE TRANSACTION
// ============================================================

router.get(
  "/:transactionId",
  authenticate,
  transactionHistoryRateLimiter,
  authorize("CUSTOMER", "ADMIN", "SUPPORT", "AUDITOR"),
  getTransaction,
);

export default router;