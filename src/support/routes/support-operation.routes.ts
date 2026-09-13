import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";

import {
  recordSupportOperation,
} from "../controllers/support-operation.controller";

import {
  supportOperationBodySchema,
  supportOperationParamsSchema,
} from "../schemas/support-operation.schema";

const router = Router();

router.post(
  "/:customerId/support-operations",
  authenticate,
  authorize("SUPPORT"),
  validate({
    params: supportOperationParamsSchema,
    body: supportOperationBodySchema,
  }),
  recordSupportOperation,
);

export default router;