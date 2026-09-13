import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import {
  decideApprovalRequest,
  getApprovalRequest,
  getApprovalRequests,
} from "../controllers/approval.controller";

const router = Router();

router.get(
  "/fx-requests",
  authenticate,
  authorize("ADMIN", "AUDITOR", "SUPPORT"),
  getApprovalRequests,
);

router.get(
  "/fx-requests/:requestId",
  authenticate,
  authorize("ADMIN", "AUDITOR", "SUPPORT"),
  getApprovalRequest,
);

router.post(
  "/fx-requests/:requestId/decision",
  authenticate,
  authorize("ADMIN"),
  decideApprovalRequest,
);

export default router;