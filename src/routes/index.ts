import { Router } from "express";
import authRoutes from "../auth/routes/auth.route";
import adminRoutes from "../auth/routes/admin.routes";
import transactionRoutes from "../transaction/routes/transaction.routes";
import beneficiaryRoutes from "../transaction/routes/beneficiary.routes";
import fxRequestRoutes from "../transaction/routes/fx-request.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/admin", adminRoutes);
router.use("/transactions", transactionRoutes);
router.use("/beneficiaries", beneficiaryRoutes);
router.use("/fx-requests", fxRequestRoutes);

export default router;