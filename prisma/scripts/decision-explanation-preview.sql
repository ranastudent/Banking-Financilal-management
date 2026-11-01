-- CreateEnum
CREATE TYPE "DecisionExplanationPhase" AS ENUM ('PHASE32', 'PHASE33', 'SHARED');

-- CreateEnum
CREATE TYPE "DecisionExplanationSource" AS ENUM ('PHASE32_RISK_ENGINE', 'PHASE33_MONITORING', 'TRANSACTION_VALIDATION', 'COMPLIANCE_REVIEW', 'MANUAL_REVIEW', 'SYSTEM_VALIDATION');

-- CreateEnum
CREATE TYPE "CustomerTransactionDecision" AS ENUM ('APPROVED', 'ON_HOLD', 'REJECTED', 'CANCELLED', 'NEEDS_VERIFICATION', 'PROCESSING');

-- CreateEnum
CREATE TYPE "TransactionExplanationStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "transaction_decision_explanations" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "phase" "DecisionExplanationPhase" NOT NULL,
    "source" "DecisionExplanationSource" NOT NULL,
    "decision" "CustomerTransactionDecision" NOT NULL,
    "decision_version" INTEGER NOT NULL DEFAULT 1,
    "status" "TransactionExplanationStatus" NOT NULL DEFAULT 'ACTIVE',
    "risk_analysis_id" UUID,
    "monitoring_event_id" UUID,
    "fraud_alert_id" UUID,
    "customer_title" TEXT NOT NULL,
    "customer_message" TEXT NOT NULL,
    "reason_codes" JSONB NOT NULL,
    "required_actions" JSONB,
    "transaction_impact" JSONB NOT NULL,
    "public_reference" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "decision_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transaction_decision_explanations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transaction_decision_explanations_public_reference_key" ON "transaction_decision_explanations"("public_reference");

-- CreateIndex
CREATE INDEX "transaction_decision_explanations_customer_id_created_at_idx" ON "transaction_decision_explanations"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "transaction_decision_explanations_transaction_id_status_idx" ON "transaction_decision_explanations"("transaction_id", "status");

-- CreateIndex
CREATE INDEX "transaction_decision_explanations_decision_created_at_idx" ON "transaction_decision_explanations"("decision", "created_at");

-- CreateIndex
CREATE INDEX "transaction_decision_explanations_phase_created_at_idx" ON "transaction_decision_explanations"("phase", "created_at");

-- CreateIndex
CREATE INDEX "transaction_decision_explanations_source_created_at_idx" ON "transaction_decision_explanations"("source", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_decision_explanations_transaction_id_decision_v_key" ON "transaction_decision_explanations"("transaction_id", "decision_version");

-- AddForeignKey
ALTER TABLE "transaction_decision_explanations" ADD CONSTRAINT "transaction_decision_explanations_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_decision_explanations" ADD CONSTRAINT "transaction_decision_explanations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_decision_explanations" ADD CONSTRAINT "transaction_decision_explanations_risk_analysis_id_fkey" FOREIGN KEY ("risk_analysis_id") REFERENCES "risk_analyses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_decision_explanations" ADD CONSTRAINT "transaction_decision_explanations_monitoring_event_id_fkey" FOREIGN KEY ("monitoring_event_id") REFERENCES "monitoring_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_decision_explanations" ADD CONSTRAINT "transaction_decision_explanations_fraud_alert_id_fkey" FOREIGN KEY ("fraud_alert_id") REFERENCES "fraud_alerts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
