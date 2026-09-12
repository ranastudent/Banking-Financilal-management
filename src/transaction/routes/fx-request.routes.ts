import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { getFxRequest } from "../controllers/fx-request.controller";

const router = Router();

router.get(
  "/:requestId",
  authenticate,
  authorize("CUSTOMER", "ADMIN", "SUPPORT", "AUDITOR"),
  getFxRequest,
);

export default router;