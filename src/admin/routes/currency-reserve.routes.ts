import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import {
  adjustCurrencyReserve,
  getCurrencyReserve,
  getCurrencyReserves,
} from "../controllers/currency-reserve.controller";


const router = Router();

router.get(
  "/",
  authenticate,
  authorize("ADMIN", "AUDITOR"),
  getCurrencyReserves,
);

router.get(
  "/:currencyCode",
  authenticate,
  authorize("ADMIN", "AUDITOR"),
  getCurrencyReserve,
);

router.post(
  "/:currencyCode/adjust",
  authenticate,
  authorize("ADMIN"),
  adjustCurrencyReserve,
);

export default router;