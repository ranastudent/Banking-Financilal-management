import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import {
  getNotifications,
  markNotificationAsRead,
} from "../controllers/notification.controller";

const router = Router();

router.get("/", authenticate, getNotifications);
router.patch("/:id/read", authenticate, markNotificationAsRead);

export default router;
