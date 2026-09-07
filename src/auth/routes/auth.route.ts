import { Router } from "express";

import { register } from "../controllers/auth.controller";
import { login } from "../controllers/login.controller";
import { verifyEmailController } from "../controllers/verify-email.controller";
import { refreshToken } from "../controllers/refresh-token.controller";

import {
  loginSchema,
  registerSchema,
} from "../schemas/auth.schema";
import { verifyEmailSchema } from "../schemas/verifyEmail.schema";
import { refreshTokenSchema } from "../schemas/refresh-token.schema";

import { validate } from "../../middleware/validate";

const router = Router();

router.post(
  "/register",
  validate({ body: registerSchema }),
  register,
);

router.post(
  "/login",
  validate({ body: loginSchema }),
  login,
);

router.post(
  "/verify-email",
  validate({ body: verifyEmailSchema }),
  verifyEmailController,
);

router.post(
  "/refresh",
  validate({ body: refreshTokenSchema }),
  refreshToken,
);

export default router;