import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import {
  getUser,
  getUsers,
} from "../controllers/user.controller";

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

export default router;