import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";

import {
  getCustomerBeneficiary,
} from "../controllers/beneficiary.controller";

import {
  beneficiaryAssistanceParamsSchema,
} from "../schemas/beneficiary.schema";

const router = Router();

router.get(
  "/:customerId/beneficiaries/:beneficiaryId",
  authenticate,
  authorize("SUPPORT"),
  validate({
    params: beneficiaryAssistanceParamsSchema,
  }),
  getCustomerBeneficiary,
);

export default router;