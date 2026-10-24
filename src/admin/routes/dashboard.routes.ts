import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { getDashboard } from "../controllers/dashboard.controller";

const router = Router();

router.get("/", authenticate, authorize("ADMIN"), getDashboard);

export default router;
