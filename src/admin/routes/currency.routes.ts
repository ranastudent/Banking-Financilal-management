import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import {
  changeCurrencyStatus,
  getCurrency,
  getCurrencies,
} from "../controllers/currency.controller";

const router = Router();

router.get(
  "/",
  authenticate,
  authorize("ADMIN", "AUDITOR", "SUPPORT"),
  getCurrencies,
);

router.get(
  "/:code",
  authenticate,
  authorize("ADMIN", "AUDITOR", "SUPPORT"),
  getCurrency,
);

router.patch(
  "/:code/status",
  authenticate,
  authorize("ADMIN"),
  changeCurrencyStatus,
);

export default router;