import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { getRiskReview, listRiskReviews, postRiskReviewDecision } from "../controllers/risk-review.controller";

const router = Router();
router.use(authenticate, authorize("ADMIN"));
router.get("/", listRiskReviews);
router.get("/:riskAnalysisId", getRiskReview);
router.post("/:riskAnalysisId/decision", postRiskReviewDecision);
export default router;
