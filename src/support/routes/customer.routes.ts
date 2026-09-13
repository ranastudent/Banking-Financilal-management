import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";

import { lookupCustomersController } from "../controllers/customer.controller";
import { customerLookupQuerySchema } from "../schemas/customer.schema";

const router = Router();

router.get(
  "/",
  authenticate,
  authorize("SUPPORT"),
  validate({
    query: customerLookupQuerySchema,
  }),
  lookupCustomersController,
);

export default router;