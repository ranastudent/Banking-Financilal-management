import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import {
  getTransaction,
  getTransactions,
} from "../controllers/transaction.controller";

const router = Router();

router.get(
  "/",
  authenticate,
  authorize("ADMIN"),
  getTransactions,
);

router.get(
  "/:transactionId",
  authenticate,
  authorize("ADMIN"),
  getTransaction,
);

export default router;