-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CUSTOMER', 'ADMIN', 'SUPPORT', 'AUDITOR');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('SAVINGS', 'CURRENT', 'FOREIGN_CURRENCY');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'FROZEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ExchangeRateStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'INTERNAL_TRANSFER', 'EXTERNAL_DEPOSIT', 'EXTERNAL_TRANSFER', 'FX_CONVERSION', 'REFUND');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "TransactionProvider" AS ENUM ('INTERNAL', 'BKASH', 'NAGAD', 'ROCKET', 'PAYPAL', 'PAYONEER', 'WISE');

-- CreateEnum
CREATE TYPE "TransactionEntryType" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "ForeignCurrencyRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'NEEDS_MORE_INFORMATION', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVED', 'REJECTED', 'NEEDS_MORE_INFORMATION');

-- CreateEnum
CREATE TYPE "ReserveMovementType" AS ENUM ('CUSTOMER_FX_PURCHASE', 'CUSTOMER_FX_SELL', 'EXTERNAL_SETTLEMENT', 'ADMIN_ADJUSTMENT', 'OPENING_BALANCE');

-- CreateEnum
CREATE TYPE "BeneficiaryType" AS ENUM ('INTERNAL', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "BeneficiaryStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('INTERNAL', 'BKASH', 'NAGAD', 'ROCKET', 'PAYPAL', 'PAYONEER', 'WISE');

-- CreateEnum
CREATE TYPE "ExternalProviderTransactionStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('REGISTRATION_OTP', 'EMAIL_VERIFICATION', 'TRANSACTION', 'FX_REQUEST', 'FX_APPROVAL', 'SECURITY', 'SYSTEM');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS', 'IN_APP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'READ');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'CUSTOMER',
    "status" "UserStatus" NOT NULL DEFAULT 'INACTIVE',
    "email_verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "account_number" TEXT NOT NULL,
    "account_type" "AccountType" NOT NULL DEFAULT 'SAVINGS',
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currencies" (
    "code" CHAR(3) NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT,
    "decimal_places" INTEGER NOT NULL DEFAULT 2,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "account_balances" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "available_balance" DECIMAL(24,8) NOT NULL DEFAULT 0,
    "locked_balance" DECIMAL(24,8) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currency_reserves" (
    "id" UUID NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "available_reserve" DECIMAL(24,8) NOT NULL DEFAULT 0,
    "locked_reserve" DECIMAL(24,8) NOT NULL DEFAULT 0,
    "minimum_reserve" DECIMAL(24,8) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "currency_reserves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" UUID NOT NULL,
    "base_currency" CHAR(3) NOT NULL,
    "quote_currency" CHAR(3) NOT NULL,
    "rate" DECIMAL(24,10) NOT NULL,
    "buy_rate" DECIMAL(24,10),
    "sell_rate" DECIMAL(24,10),
    "spread" DECIMAL(24,10),
    "source" TEXT,
    "version" INTEGER NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "status" "ExchangeRateStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(24,8) NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "source_account_id" UUID,
    "destination_account_id" UUID,
    "provider" "TransactionProvider" NOT NULL DEFAULT 'INTERNAL',
    "provider_transaction_id" TEXT,
    "idempotency_key" TEXT,
    "failure_code" TEXT,
    "failure_reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_legs" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "entryType" "TransactionEntryType" NOT NULL,
    "amount" DECIMAL(24,8) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_legs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "entryType" "TransactionEntryType" NOT NULL,
    "amount" DECIMAL(24,8) NOT NULL,
    "balance_before" DECIMAL(24,8) NOT NULL,
    "balance_after" DECIMAL(24,8) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "foreign_currency_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "requested_currency" CHAR(3) NOT NULL,
    "requested_amount" DECIMAL(24,8) NOT NULL,
    "purpose_category" TEXT NOT NULL,
    "purpose_description" TEXT NOT NULL,
    "supporting_reference" TEXT,
    "status" "ForeignCurrencyRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "review_notes" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "foreign_currency_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_records" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reserve_movements" (
    "id" UUID NOT NULL,
    "reserve_id" UUID NOT NULL,
    "transaction_id" UUID,
    "currency_code" CHAR(3) NOT NULL,
    "movementType" "ReserveMovementType" NOT NULL,
    "amount" DECIMAL(24,8) NOT NULL,
    "balance_before" DECIMAL(24,8) NOT NULL,
    "balance_after" DECIMAL(24,8) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reserve_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beneficiaries" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "beneficiary_type" "BeneficiaryType" NOT NULL,
    "display_name" TEXT NOT NULL,
    "account_reference" TEXT NOT NULL,
    "provider" "PaymentProvider",
    "currency_code" CHAR(3) NOT NULL,
    "status" "BeneficiaryStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "beneficiaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_provider_transactions" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "provider_transaction_id" TEXT NOT NULL,
    "external_reference" TEXT,
    "currency_code" CHAR(3) NOT NULL,
    "amount" DECIMAL(24,8) NOT NULL,
    "status" "ExternalProviderTransactionStatus" NOT NULL,
    "request_payload_hash" TEXT,
    "response_metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_provider_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "description" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "user_id" UUID,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_account_number_key" ON "accounts"("account_number");

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

-- CreateIndex
CREATE INDEX "accounts_status_idx" ON "accounts"("status");

-- CreateIndex
CREATE INDEX "currencies_is_active_idx" ON "currencies"("is_active");

-- CreateIndex
CREATE INDEX "account_balances_currency_code_idx" ON "account_balances"("currency_code");

-- CreateIndex
CREATE UNIQUE INDEX "account_balances_account_id_currency_code_key" ON "account_balances"("account_id", "currency_code");

-- CreateIndex
CREATE UNIQUE INDEX "currency_reserves_currency_code_key" ON "currency_reserves"("currency_code");

-- CreateIndex
CREATE INDEX "exchange_rates_base_currency_quote_currency_status_idx" ON "exchange_rates"("base_currency", "quote_currency", "status");

-- CreateIndex
CREATE INDEX "exchange_rates_effective_from_idx" ON "exchange_rates"("effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_base_currency_quote_currency_version_key" ON "exchange_rates"("base_currency", "quote_currency", "version");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_reference_key" ON "transactions"("reference");

-- CreateIndex
CREATE INDEX "transactions_status_created_at_idx" ON "transactions"("status", "created_at");

-- CreateIndex
CREATE INDEX "transactions_source_account_id_created_at_idx" ON "transactions"("source_account_id", "created_at");

-- CreateIndex
CREATE INDEX "transactions_destination_account_id_created_at_idx" ON "transactions"("destination_account_id", "created_at");

-- CreateIndex
CREATE INDEX "transactions_provider_provider_transaction_id_idx" ON "transactions"("provider", "provider_transaction_id");

-- CreateIndex
CREATE INDEX "transactions_currency_code_created_at_idx" ON "transactions"("currency_code", "created_at");

-- CreateIndex
CREATE INDEX "transactions_idempotency_key_idx" ON "transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "transaction_legs_transaction_id_idx" ON "transaction_legs"("transaction_id");

-- CreateIndex
CREATE INDEX "transaction_legs_account_id_currency_code_idx" ON "transaction_legs"("account_id", "currency_code");

-- CreateIndex
CREATE INDEX "transaction_legs_currency_code_created_at_idx" ON "transaction_legs"("currency_code", "created_at");

-- CreateIndex
CREATE INDEX "ledger_entries_transaction_id_idx" ON "ledger_entries"("transaction_id");

-- CreateIndex
CREATE INDEX "ledger_entries_account_id_currency_code_created_at_idx" ON "ledger_entries"("account_id", "currency_code", "created_at");

-- CreateIndex
CREATE INDEX "ledger_entries_currency_code_created_at_idx" ON "ledger_entries"("currency_code", "created_at");

-- CreateIndex
CREATE INDEX "foreign_currency_requests_user_id_created_at_idx" ON "foreign_currency_requests"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "foreign_currency_requests_status_created_at_idx" ON "foreign_currency_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "foreign_currency_requests_requested_currency_status_idx" ON "foreign_currency_requests"("requested_currency", "status");

-- CreateIndex
CREATE INDEX "foreign_currency_requests_account_id_idx" ON "foreign_currency_requests"("account_id");

-- CreateIndex
CREATE INDEX "approval_records_request_id_created_at_idx" ON "approval_records"("request_id", "created_at");

-- CreateIndex
CREATE INDEX "approval_records_reviewer_id_created_at_idx" ON "approval_records"("reviewer_id", "created_at");

-- CreateIndex
CREATE INDEX "reserve_movements_currency_code_created_at_idx" ON "reserve_movements"("currency_code", "created_at");

-- CreateIndex
CREATE INDEX "reserve_movements_reserve_id_created_at_idx" ON "reserve_movements"("reserve_id", "created_at");

-- CreateIndex
CREATE INDEX "reserve_movements_transaction_id_idx" ON "reserve_movements"("transaction_id");

-- CreateIndex
CREATE INDEX "beneficiaries_currency_code_idx" ON "beneficiaries"("currency_code");

-- CreateIndex
CREATE INDEX "beneficiaries_user_id_status_idx" ON "beneficiaries"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "external_provider_transactions_transaction_id_key" ON "external_provider_transactions"("transaction_id");

-- CreateIndex
CREATE INDEX "external_provider_transactions_provider_status_idx" ON "external_provider_transactions"("provider", "status");

-- CreateIndex
CREATE INDEX "external_provider_transactions_currency_code_created_at_idx" ON "external_provider_transactions"("currency_code", "created_at");

-- CreateIndex
CREATE INDEX "external_provider_transactions_external_reference_idx" ON "external_provider_transactions"("external_reference");

-- CreateIndex
CREATE UNIQUE INDEX "external_provider_transactions_provider_provider_transactio_key" ON "external_provider_transactions"("provider", "provider_transaction_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_status_idx" ON "notifications"("user_id", "status");

-- CreateIndex
CREATE INDEX "notifications_type_created_at_idx" ON "notifications"("type", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records"("expires_at");

-- CreateIndex
CREATE INDEX "idempotency_records_user_id_created_at_idx" ON "idempotency_records"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_key_user_id_key" ON "idempotency_records"("key", "user_id");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_balances" ADD CONSTRAINT "account_balances_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_balances" ADD CONSTRAINT "account_balances_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "currency_reserves" ADD CONSTRAINT "currency_reserves_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_base_currency_fkey" FOREIGN KEY ("base_currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_quote_currency_fkey" FOREIGN KEY ("quote_currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_source_account_id_fkey" FOREIGN KEY ("source_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_destination_account_id_fkey" FOREIGN KEY ("destination_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_legs" ADD CONSTRAINT "transaction_legs_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_legs" ADD CONSTRAINT "transaction_legs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_legs" ADD CONSTRAINT "transaction_legs_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "foreign_currency_requests" ADD CONSTRAINT "foreign_currency_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "foreign_currency_requests" ADD CONSTRAINT "foreign_currency_requests_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "foreign_currency_requests" ADD CONSTRAINT "foreign_currency_requests_requested_currency_fkey" FOREIGN KEY ("requested_currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "foreign_currency_requests" ADD CONSTRAINT "foreign_currency_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_records" ADD CONSTRAINT "approval_records_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "foreign_currency_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_records" ADD CONSTRAINT "approval_records_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserve_movements" ADD CONSTRAINT "reserve_movements_reserve_id_fkey" FOREIGN KEY ("reserve_id") REFERENCES "currency_reserves"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserve_movements" ADD CONSTRAINT "reserve_movements_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserve_movements" ADD CONSTRAINT "reserve_movements_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_provider_transactions" ADD CONSTRAINT "external_provider_transactions_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_provider_transactions" ADD CONSTRAINT "external_provider_transactions_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
