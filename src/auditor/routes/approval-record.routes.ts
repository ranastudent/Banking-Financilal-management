import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";

import {
  getAuditorApprovalRecordController,
  getAuditorApprovalRecordsController,
} from "../controllers/approval-record.controller";

import {
  auditorApprovalRecordParamsSchema,
  auditorApprovalRecordQuerySchema,
} from "../schemas/approval-record.schema";

const router = Router();

router.get(
  "/",
  authenticate,
  authorize("AUDITOR"),
  validate({
    query: auditorApprovalRecordQuerySchema,
  }),
  getAuditorApprovalRecordsController,
);

router.get(
  "/:approvalRecordId",
  authenticate,
  authorize("AUDITOR"),
  validate({
    params: auditorApprovalRecordParamsSchema,
  }),
  getAuditorApprovalRecordController,
);

export default router;