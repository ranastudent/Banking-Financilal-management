import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { authorizeDeposit } from "../controllers/deposit.controller";
import { withdrawalAuthorizationController } from "../controllers/withdrawal.controller";
import { transferAuthorizationController } from "../controllers/transfer.controller";
import { getTransaction } from "../controllers/transaction.controller";


const router = Router();

router.post(
  "/deposit/:accountId",
  authenticate,
  authorize("CUSTOMER", "ADMIN"),
  authorizeDeposit,
);

router.post(
  "/withdrawal/:accountId",
  authenticate,
  authorize("CUSTOMER", "ADMIN"),
  withdrawalAuthorizationController,
);

router.post(
  "/transfer/:sourceAccountId/:destinationAccountId",
  authenticate,
  authorize("CUSTOMER", "ADMIN"),
  transferAuthorizationController,
);

router.get(
  "/:transactionId",
  authenticate,
  authorize("CUSTOMER", "ADMIN", "SUPPORT", "AUDITOR"),
  getTransaction,
);



export default router;