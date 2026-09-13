import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";

import { getCustomerAccount } from "../controllers/account.controller";
import { customerAccountParamsSchema } from "../schemas/account.schema";

const router = Router();

router.get(
  "/:accountId",
  authenticate,
  authorize("SUPPORT"),
  validate({
    params: customerAccountParamsSchema,
  }),
  getCustomerAccount,
);

export default router;