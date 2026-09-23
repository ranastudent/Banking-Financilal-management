import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";
import {
  requireIdempotencyKey,
} from "../../middleware/idempotency.middleware";

import { processTransfer } from "../controllers/transfer.controller";
import { transferSchema } from "../schemas/transfer.schema";

const router = Router();

router.post(
  "/",
  authenticate,
  authorize("CUSTOMER", "ADMIN"),
  validate({ body: transferSchema }),
  requireIdempotencyKey,
  processTransfer,
);

export default router;