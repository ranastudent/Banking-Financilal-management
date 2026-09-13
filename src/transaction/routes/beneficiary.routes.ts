import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { getBeneficiary } from "../controllers/beneficiary.controller";

const router = Router();

router.get(
  "/:beneficiaryId",
  authenticate,
  authorize("CUSTOMER", "ADMIN", "AUDITOR"),
  getBeneficiary,
);

export default router;