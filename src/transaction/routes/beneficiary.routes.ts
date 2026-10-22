import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";
import {
  createBeneficiary,
  deleteBeneficiary,
  getBeneficiary,
  listBeneficiaries,
  updateBeneficiary,
} from "../controllers/beneficiary.controller";
import {
  beneficiaryIdParamsSchema,
  createBeneficiarySchema,
  listBeneficiariesQuerySchema,
  updateBeneficiarySchema,
} from "../schemas/beneficiary.schema";

const router = Router();

// Customer-owned beneficiary management.
router.post(
  "/",
  authenticate,
  authorize("CUSTOMER"),
  validate({ body: createBeneficiarySchema }),
  createBeneficiary,
);

router.get(
  "/",
  authenticate,
  authorize("CUSTOMER"),
  validate({ query: listBeneficiariesQuerySchema }),
  listBeneficiaries,
);

router.patch(
  "/:beneficiaryId",
  authenticate,
  authorize("CUSTOMER"),
  validate({
    params: beneficiaryIdParamsSchema,
    body: updateBeneficiarySchema,
  }),
  updateBeneficiary,
);

router.delete(
  "/:beneficiaryId",
  authenticate,
  authorize("CUSTOMER"),
  validate({ params: beneficiaryIdParamsSchema }),
  deleteBeneficiary,
);

// Existing privileged read endpoint retained for compatibility.
router.get(
  "/:beneficiaryId",
  authenticate,
  authorize("CUSTOMER", "ADMIN", "AUDITOR"),
  getBeneficiary,
);

export default router;
