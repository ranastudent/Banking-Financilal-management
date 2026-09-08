import { Router } from "express";
import authRoutes from "../auth/routes/auth.route";
import adminRoutes from "../auth/routes/admin.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/admin", adminRoutes);

export default router;