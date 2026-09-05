import { Router } from "express";

import { register } from "../controllers/auth.controller";
import { verifyEmailController } from "../controllers/verify-email.controller";

import { registerSchema } from "../schemas/auth.schema";
import { verifyEmailSchema } from "../schemas/verifyEmail.schema";

import { validate } from "../../middleware/validate";

const router = Router();

router.post(
  "/register",
  validate({ body: registerSchema }),
  register,
);

router.post(
  "/verify-email",
  validate({ body: verifyEmailSchema }),
  verifyEmailController,
);

export default router;