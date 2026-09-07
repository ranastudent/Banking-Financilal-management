import { Router } from "express";

import { register } from "../controllers/auth.controller";
import { login } from "../controllers/login.controller";
import { verifyEmailController } from "../controllers/verify-email.controller";
import { refreshToken } from "../controllers/refresh-token.controller";
import { logout } from "../controllers/logout.controller";

import {
  loginSchema,
  registerSchema,
} from "../schemas/auth.schema";

import { verifyEmailSchema } from "../schemas/verifyEmail.schema";
import { refreshTokenSchema } from "../schemas/refresh-token.schema";

import { validate } from "../../middleware/validate";
import { authRateLimiter } from "../../middleware/rateLimiter";

const router = Router();

router.post(
  "/register",
  authRateLimiter,
  validate({ body: registerSchema }),
  register,
);

router.post(
  "/login",
  authRateLimiter,
  validate({ body: loginSchema }),
  login,
);

router.post(
  "/verify-email",
  authRateLimiter,
  validate({ body: verifyEmailSchema }),
  verifyEmailController,
);

router.post(
  "/refresh",
  authRateLimiter,
  validate({ body: refreshTokenSchema }),
  refreshToken,
);

router.post(
  "/logout",
  authRateLimiter,
  validate({ body: refreshTokenSchema }),
  logout,
);

export default router;