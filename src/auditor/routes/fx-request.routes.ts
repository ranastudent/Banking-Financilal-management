import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";

import {
  getAuditorFxRequestController,
  getAuditorFxRequestsController,
} from "../controllers/fx-request.controller";

import {
  auditorFxRequestParamsSchema,
  auditorFxRequestQuerySchema,
} from "../schemas/fx-request.schema";

const router = Router();

router.get(
  "/",
  authenticate,
  authorize("AUDITOR"),
  validate({
    query: auditorFxRequestQuerySchema,
  }),
  getAuditorFxRequestsController,
);

router.get(
  "/:requestId",
  authenticate,
  authorize("AUDITOR"),
  validate({
    params: auditorFxRequestParamsSchema,
  }),
  getAuditorFxRequestController,
);

export default router;