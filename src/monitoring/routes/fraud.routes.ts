import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";
import {
  addFraudCaseEvidenceSchema,
  addFraudCaseNoteSchema,
  assignFraudCaseSchema,
  fraudAlertParamsSchema,
  fraudCaseParamsSchema,
  updateFraudAlertSchema,
  updateFraudCaseSchema,
} from "../schemas/fraud.schema";
import {
  listAlerts,
  updateAlert,
  createCase,
  listCases,
  addCaseNote,
  addCaseEvidence,
  assignCase,
  updateCase,
  dashboard,
} from "../controllers/fraud.controller";

const router = Router();

router.use(authenticate, authorize("ADMIN"));

router.get("/alerts", listAlerts);
router.patch(
  "/alerts/:alertId",
  validate({
    params: fraudAlertParamsSchema,
    body: updateFraudAlertSchema,
  }),
  updateAlert,
);
router.post(
  "/alerts/:alertId/cases",
  validate({ params: fraudAlertParamsSchema }),
  createCase,
);
router.get("/cases", listCases);
router.post(
  "/cases/:caseId/notes",
  validate({
    params: fraudCaseParamsSchema,
    body: addFraudCaseNoteSchema,
  }),
  addCaseNote,
);
router.post(
  "/cases/:caseId/evidence",
  validate({
    params: fraudCaseParamsSchema,
    body: addFraudCaseEvidenceSchema,
  }),
  addCaseEvidence,
);
router.post(
  "/cases/:caseId/assignments",
  validate({
    params: fraudCaseParamsSchema,
    body: assignFraudCaseSchema,
  }),
  assignCase,
);
router.patch(
  "/cases/:caseId",
  validate({
    params: fraudCaseParamsSchema,
    body: updateFraudCaseSchema,
  }),
  updateCase,
);
router.get("/dashboard", dashboard);

export default router;
