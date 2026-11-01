import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { ingestEvent, retryEvent } from "../controllers/monitoring.controller";
const router = Router();
router.post("/events", authenticate, authorize("ADMIN"), ingestEvent);
router.post("/events/:eventId/reprocess", authenticate, authorize("ADMIN"), retryEvent);
export default router;
