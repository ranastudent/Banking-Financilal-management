import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";

import { getAuditorAccountActivityController } from "../controllers/account.controller";

import {
  auditorAccountActivityParamsSchema,
  auditorAccountActivityQuerySchema,
} from "../schemas/account.schema";

const router = Router();

router.get(
  "/:accountId/activity",
  authenticate,
  authorize("AUDITOR"),
  validate({
    params: auditorAccountActivityParamsSchema,
    query: auditorAccountActivityQuerySchema,
  }),
  getAuditorAccountActivityController,
);

export default router;