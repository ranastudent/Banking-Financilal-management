import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { myDecisionExplanations } from "../controllers/decision-explanation.controller";
const router = Router();
router.get("/me", authenticate, myDecisionExplanations);
export default router;
