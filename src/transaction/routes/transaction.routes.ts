import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { authorizeDeposit } from "../controllers/deposit.controller";
import { withdrawalAuthorizationController } from "../controllers/withdrawal.controller";

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

export default router;