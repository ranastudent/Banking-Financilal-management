import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import {
  getExchangeRate,
  getExchangeRates,
} from "../controllers/exchange-rate.controller";
import { createExchangeRate } from "../controllers/exchange-rate.controller";

const router = Router();

router.get(
  "/",
  authenticate,
  authorize("CUSTOMER", "ADMIN", "SUPPORT", "AUDITOR"),
  getExchangeRates,
);

router.get(
  "/:exchangeRateId",
  authenticate,
  authorize("CUSTOMER", "ADMIN", "SUPPORT", "AUDITOR"),
  getExchangeRate,
);

router.post(
  "/",
  authenticate,
  authorize("ADMIN"),
  createExchangeRate,
);

export default router;