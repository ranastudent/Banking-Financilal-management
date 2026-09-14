import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";

import {
  getAuditorAuditLogController,
  getAuditorAuditLogsController,
} from "../controllers/audit-log.controller";

import {
  auditorAuditLogParamsSchema,
  auditorAuditLogQuerySchema,
} from "../schemas/audit-log.schema";

const router = Router();

router.get(
  "/",
  authenticate,
  authorize("AUDITOR"),
  validate({
    query: auditorAuditLogQuerySchema,
  }),
  getAuditorAuditLogsController,
);

router.get(
  "/:auditLogId",
  authenticate,
  authorize("AUDITOR"),
  validate({
    params: auditorAuditLogParamsSchema,
  }),
  getAuditorAuditLogController,
);

export default router;