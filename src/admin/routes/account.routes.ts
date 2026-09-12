import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import {
  getAccount,
  getAccounts,
} from "../controllers/account.controller";

const router = Router();

router.get(
  "/",
  authenticate,
  authorize("ADMIN"),
  getAccounts,
);

router.get(
  "/:accountId",
  authenticate,
  authorize("ADMIN"),
  getAccount,
);

export default router;