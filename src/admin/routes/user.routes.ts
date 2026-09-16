import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import {
  updateUserStatus,
  getUser,
  getUsers,
} from "../controllers/user.controller";
import { updateUserStatusSchema } from "../schemas/user.schema";
import { validate } from "../../middleware/validate";

const router = Router();

router.get(
  "/",
  authenticate,
  authorize("ADMIN"),
  getUsers,
);

router.get(
  "/:userId",
  authenticate,
  authorize("ADMIN"),
  getUser,
);

router.patch(
  "/:userId/status",
  authenticate,
  authorize("ADMIN"),
  validate({
    body: updateUserStatusSchema,
  }),
  updateUserStatus,
);

export default router;