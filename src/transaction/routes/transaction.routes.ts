import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { authorizeDeposit } from "../controllers/deposit.controller";

const router = Router();

router.post(
  "/deposit/:accountId",
  authenticate,
  authorize("CUSTOMER", "ADMIN"),
  authorizeDeposit,
);

export default router;