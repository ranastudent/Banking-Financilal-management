import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { getAdminTest } from "../controllers/admin-test.controller";

const router = Router();

router.get(
  "/test",
  authenticate,
  authorize("ADMIN"),
  getAdminTest,
);

export default router;