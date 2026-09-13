import { Router } from "express";
import authRoutes from "../auth/routes/auth.route";
import adminRoutes from "../auth/routes/admin.routes";
import transactionRoutes from "../transaction/routes/transaction.routes";
import beneficiaryRoutes from "../transaction/routes/beneficiary.routes";
import fxRequestRoutes from "../transaction/routes/fx-request.routes";
import adminUserRoutes from "../admin/routes/user.routes";
import adminAccountRoutes from "../admin/routes/account.routes";
import adminTransactionRoutes from "../admin/routes/transaction.routes";
import adminAuditLogRoutes from "../admin/routes/audit-log.routes";
import adminCurrencyRoutes from "../admin/routes/currency.routes";
import adminExchangeRateRoutes from "../admin/routes/exchange-rate.routes";
import adminCurrencyReserveRoutes from "../admin/routes/currency-reserve.routes";
import adminApprovalRoutes from "../admin/routes/approval.routes";
import supportCustomerRoutes from "../support/routes/customer.routes";
import supportAccountRoutes from "../support/routes/account.routes";
import supportTransactionRoutes from "../support/routes/transaction.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/admin", adminRoutes);
router.use("/transactions", transactionRoutes);
router.use("/beneficiaries", beneficiaryRoutes);
router.use("/fx-requests", fxRequestRoutes);
router.use("/admin/users", adminUserRoutes);
router.use("/admin/accounts", adminAccountRoutes);
router.use("/admin/transactions", adminTransactionRoutes);
router.use("/admin/audit-logs", adminAuditLogRoutes);
router.use("/admin/currencies", adminCurrencyRoutes);
router.use("/admin/exchange-rates", adminExchangeRateRoutes);
router.use("/admin/currency-reserves",adminCurrencyReserveRoutes,);
router.use("/admin/approvals", adminApprovalRoutes,);
router.use("/support/customers",supportCustomerRoutes,);
router.use("/support/customers/accounts",supportAccountRoutes,);
router.use("/support/customers",supportTransactionRoutes,);

export default router;