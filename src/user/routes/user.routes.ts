import { Router } from "express";

import { authenticate } from "../../middleware/authenticate";
import { validate } from "../../middleware/validate";

import {
  getMyProfile,
  updateMyProfile,
} from "../controllers/user.controller";

import { updateMyProfileSchema } from "../schemas/user.schema";

const router = Router();

router.get(
  "/me",
  authenticate,
  getMyProfile,
);

router.patch(
  "/me",
  authenticate,
  validate({
    body: updateMyProfileSchema,
  }),
  updateMyProfile,
);

export default router;