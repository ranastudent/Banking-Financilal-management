import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";

import {
  getSupportAuditLogController,
  getSupportAuditLogsController,
} from "../controllers/audit-log.controller";

import {
  supportAuditLogParamsSchema,
  supportAuditLogQuerySchema,
} from "../schemas/audit-log.schema";

const router = Router();

router.get(
  "/",
  authenticate,
  authorize("SUPPORT"),
  validate({
    query: supportAuditLogQuerySchema,
  }),
  getSupportAuditLogsController,
);

router.get(
  "/:auditLogId",
  authenticate,
  authorize("SUPPORT"),
  validate({
    params: supportAuditLogParamsSchema,
  }),
  getSupportAuditLogController,
);

export default router;