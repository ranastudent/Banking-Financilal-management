import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";
import { requireIdempotencyKey, } from "../../middleware/idempotency.middleware";

import {
  createAccount,
  updateAccountStatus,
} from "../controllers/account.controller";

import {
  getAccounts,
  getAccount,
} from "../controllers/account.controller";

import {  processDeposit } from "../../transaction/controllers/deposit.controller";
import {processWithdrawal} from "../../transaction/controllers/withdrawal.controller";

import {createAccountSchema,updateAccountStatusSchema,} from "../schemas/account.schema";

import { depositSchema } from "../schemas/deposit.schema";

import { withdrawalSchema } from "../schemas/withdrawal.schema";

const router = Router();

router.post(
  "/",
  authenticate,
  authorize("CUSTOMER"),
  validate({
    body: createAccountSchema,
  }),
  createAccount,
);

router.get(
  "/",
  authenticate,
  authorize("CUSTOMER"),
  getAccounts,
);

router.get(
  "/:accountId",
  authenticate,
  authorize("CUSTOMER"),
  getAccount,
);

router.patch(
  "/:accountId/status",
  authenticate,
  authorize("CUSTOMER"),
  validate({
    body: updateAccountStatusSchema,
  }),
  updateAccountStatus,
);

router.post(
  "/:accountId/deposits",
  authenticate,
  authorize("CUSTOMER", "ADMIN"),
  validate({
    body: depositSchema,
  }),
  requireIdempotencyKey,
  processDeposit,
);

router.post(
  "/:accountId/deposits",
  authenticate,
  authorize("CUSTOMER", "ADMIN"),
  validate({
    body: depositSchema,
  }),
  requireIdempotencyKey,
  processDeposit,
);

router.post(
  "/:accountId/withdrawals",
  authenticate,
  authorize("CUSTOMER", "ADMIN"),
  validate({
    body: withdrawalSchema,
  }),
  requireIdempotencyKey,
  processWithdrawal,
);

export default router;