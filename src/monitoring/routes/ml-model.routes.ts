import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";
import {
  createFraudModelSchema,
  fraudModelIdParamsSchema,
  transitionFraudModelSchema,
} from "../schemas/ml-model.schema";
import { listModels, createModel, transitionModel } from "../controllers/ml-model.controller";

const router = Router();

router.use(authenticate, authorize("ADMIN"));
router.get("/", listModels);
router.post("/", validate({ body: createFraudModelSchema }), createModel);
router.patch(
  "/:modelId/lifecycle",
  validate({ params: fraudModelIdParamsSchema, body: transitionFraudModelSchema }),
  transitionModel,
);

export default router;
