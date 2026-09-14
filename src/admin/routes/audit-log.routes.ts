import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import {
  getAuditLog,
  getAuditLogs,
} from "../controllers/audit-log.controller";

const router = Router();

router.get(
  "/",
  authenticate,
  authorize("ADMIN", "AUDITOR",),
  getAuditLogs,
);

router.get(
  "/:auditLogId",
  authenticate,
  authorize("ADMIN", "AUDITOR",),
  getAuditLog,
);

export default router;