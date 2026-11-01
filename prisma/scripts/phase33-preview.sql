-- CreateEnum
CREATE TYPE "MonitoringEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "MonitoringSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "FraudDetectionSource" AS ENUM ('PHASE32_RULE', 'MONITORING_RULE', 'BEHAVIORAL_ANALYTICS', 'STATISTICAL_ANOMALY', 'ML_MODEL', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "FraudAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED', 'ESCALATED', 'FALSE_POSITIVE');

-- CreateEnum
CREATE TYPE "FraudCaseStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'INVESTIGATING', 'PENDING_INFORMATION', 'ESCALATED', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "FraudCasePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "FraudCaseResolution" AS ENUM ('CONFIRMED_FRAUD', 'NO_FRAUD', 'INCONCLUSIVE', 'DUPLICATE', 'OTHER');

-- CreateEnum
CREATE TYPE "FraudEvidenceType" AS ENUM ('DOCUMENT', 'IMAGE', 'TRANSACTION_REFERENCE', 'SYSTEM_LOG', 'EXTERNAL_REFERENCE', 'OTHER');

-- CreateEnum
CREATE TYPE "FraudModelStatus" AS ENUM ('DRAFT', 'VALIDATING', 'APPROVED', 'DEPLOYED', 'DISABLED', 'RETIRED');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'RISK_ANALYST';

-- CreateTable
CREATE TABLE "monitoring_events" (
    "id" UUID NOT NULL,
    "event_key" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "status" "MonitoringEventStatus" NOT NULL DEFAULT 'PENDING',
    "transaction_id" UUID,
    "account_id" UUID,
    "user_id" UUID,
    "correlation_id" TEXT,
    "source" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monitoring_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitoring_processing_logs" (
    "id" UUID NOT NULL,
    "monitoring_event_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitoring_processing_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_behavior_profiles" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "window_code" TEXT NOT NULL,
    "feature_version" INTEGER NOT NULL DEFAULT 1,
    "transaction_count" INTEGER NOT NULL DEFAULT 0,
    "failed_transaction_count" INTEGER NOT NULL DEFAULT 0,
    "average_transaction_amount" DECIMAL(24,8),
    "maximum_transaction_amount" DECIMAL(24,8),
    "daily_volume" DECIMAL(24,8),
    "weekly_volume" DECIMAL(24,8),
    "monthly_volume" DECIMAL(24,8),
    "distinct_beneficiary_count" INTEGER NOT NULL DEFAULT 0,
    "active_hours" JSONB,
    "feature_snapshot" JSONB NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "window_end" TIMESTAMP(3) NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_behavior_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anomaly_detection_results" (
    "id" UUID NOT NULL,
    "monitoring_event_id" UUID NOT NULL,
    "transaction_id" UUID,
    "account_id" UUID,
    "detection_type" TEXT NOT NULL,
    "score" DECIMAL(12,6) NOT NULL,
    "severity" "MonitoringSeverity" NOT NULL,
    "observed_value" DECIMAL(24,8),
    "expected_value" DECIMAL(24,8),
    "explanation" TEXT NOT NULL,
    "evidence" JSONB,
    "algorithm_version" TEXT NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anomaly_detection_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_model_registry" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" "FraudModelStatus" NOT NULL DEFAULT 'DRAFT',
    "training_dataset_version" TEXT,
    "feature_schema_version" TEXT NOT NULL,
    "artifact_checksum" TEXT,
    "evaluation_metrics" JSONB,
    "metadata" JSONB,
    "approved_at" TIMESTAMP(3),
    "deployed_at" TIMESTAMP(3),
    "retired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fraud_model_registry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_predictions" (
    "id" UUID NOT NULL,
    "monitoring_event_id" UUID NOT NULL,
    "transaction_id" UUID,
    "model_registry_id" UUID,
    "model_name" TEXT NOT NULL,
    "model_version" TEXT NOT NULL,
    "feature_schema_version" TEXT NOT NULL,
    "anomaly_score" DECIMAL(12,6),
    "fraud_probability" DECIMAL(8,7),
    "prediction" JSONB NOT NULL,
    "explanation" JSONB,
    "latency_ms" INTEGER,
    "predicted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_predictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_alerts" (
    "id" UUID NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "monitoring_event_id" UUID,
    "transaction_id" UUID,
    "account_id" UUID,
    "user_id" UUID,
    "source" "FraudDetectionSource" NOT NULL,
    "severity" "MonitoringSeverity" NOT NULL,
    "status" "FraudAlertStatus" NOT NULL DEFAULT 'OPEN',
    "risk_score" INTEGER,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidence" JSONB,
    "acknowledged_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "escalated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fraud_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_cases" (
    "id" UUID NOT NULL,
    "case_number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "FraudCaseStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "FraudCasePriority" NOT NULL DEFAULT 'MEDIUM',
    "resolution" "FraudCaseResolution",
    "assigned_analyst_id" UUID,
    "created_by_id" UUID,
    "resolution_summary" TEXT,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fraud_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_case_alerts" (
    "id" UUID NOT NULL,
    "fraud_case_id" UUID NOT NULL,
    "fraud_alert_id" UUID NOT NULL,
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linked_by_id" UUID,

    CONSTRAINT "fraud_case_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_case_notes" (
    "id" UUID NOT NULL,
    "fraud_case_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "is_internal" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fraud_case_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_case_evidence" (
    "id" UUID NOT NULL,
    "fraud_case_id" UUID NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "evidence_type" "FraudEvidenceType" NOT NULL,
    "storage_ref" TEXT NOT NULL,
    "file_name" TEXT,
    "mime_type" TEXT,
    "checksum" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_case_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_case_assignments" (
    "id" UUID NOT NULL,
    "fraud_case_id" UUID NOT NULL,
    "assigned_to_id" UUID NOT NULL,
    "assigned_by_id" UUID,
    "reason" TEXT,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassigned_at" TIMESTAMP(3),

    CONSTRAINT "fraud_case_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_alert_audits" (
    "id" UUID NOT NULL,
    "fraud_alert_id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "from_status" "FraudAlertStatus",
    "to_status" "FraudAlertStatus",
    "comment" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_alert_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_case_audits" (
    "id" UUID NOT NULL,
    "fraud_case_id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "from_status" "FraudCaseStatus",
    "to_status" "FraudCaseStatus",
    "comment" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_case_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "monitoring_events_event_key_key" ON "monitoring_events"("event_key");

-- CreateIndex
CREATE INDEX "monitoring_events_status_created_at_idx" ON "monitoring_events"("status", "created_at");

-- CreateIndex
CREATE INDEX "monitoring_events_event_type_occurred_at_idx" ON "monitoring_events"("event_type", "occurred_at");

-- CreateIndex
CREATE INDEX "monitoring_events_account_id_occurred_at_idx" ON "monitoring_events"("account_id", "occurred_at");

-- CreateIndex
CREATE INDEX "monitoring_events_user_id_occurred_at_idx" ON "monitoring_events"("user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "monitoring_events_transaction_id_idx" ON "monitoring_events"("transaction_id");

-- CreateIndex
CREATE INDEX "monitoring_events_correlation_id_idx" ON "monitoring_events"("correlation_id");

-- CreateIndex
CREATE INDEX "monitoring_processing_logs_monitoring_event_id_created_at_idx" ON "monitoring_processing_logs"("monitoring_event_id", "created_at");

-- CreateIndex
CREATE INDEX "monitoring_processing_logs_outcome_created_at_idx" ON "monitoring_processing_logs"("outcome", "created_at");

-- CreateIndex
CREATE INDEX "customer_behavior_profiles_currency_code_calculated_at_idx" ON "customer_behavior_profiles"("currency_code", "calculated_at");

-- CreateIndex
CREATE INDEX "customer_behavior_profiles_window_code_calculated_at_idx" ON "customer_behavior_profiles"("window_code", "calculated_at");

-- CreateIndex
CREATE UNIQUE INDEX "customer_behavior_profiles_account_id_currency_code_window__key" ON "customer_behavior_profiles"("account_id", "currency_code", "window_code");

-- CreateIndex
CREATE INDEX "anomaly_detection_results_monitoring_event_id_detected_at_idx" ON "anomaly_detection_results"("monitoring_event_id", "detected_at");

-- CreateIndex
CREATE INDEX "anomaly_detection_results_account_id_detected_at_idx" ON "anomaly_detection_results"("account_id", "detected_at");

-- CreateIndex
CREATE INDEX "anomaly_detection_results_transaction_id_idx" ON "anomaly_detection_results"("transaction_id");

-- CreateIndex
CREATE INDEX "anomaly_detection_results_severity_detected_at_idx" ON "anomaly_detection_results"("severity", "detected_at");

-- CreateIndex
CREATE INDEX "anomaly_detection_results_detection_type_detected_at_idx" ON "anomaly_detection_results"("detection_type", "detected_at");

-- CreateIndex
CREATE INDEX "fraud_model_registry_status_deployed_at_idx" ON "fraud_model_registry"("status", "deployed_at");

-- CreateIndex
CREATE UNIQUE INDEX "fraud_model_registry_name_version_key" ON "fraud_model_registry"("name", "version");

-- CreateIndex
CREATE INDEX "fraud_predictions_monitoring_event_id_predicted_at_idx" ON "fraud_predictions"("monitoring_event_id", "predicted_at");

-- CreateIndex
CREATE INDEX "fraud_predictions_transaction_id_idx" ON "fraud_predictions"("transaction_id");

-- CreateIndex
CREATE INDEX "fraud_predictions_model_name_model_version_predicted_at_idx" ON "fraud_predictions"("model_name", "model_version", "predicted_at");

-- CreateIndex
CREATE INDEX "fraud_predictions_model_registry_id_idx" ON "fraud_predictions"("model_registry_id");

-- CreateIndex
CREATE UNIQUE INDEX "fraud_alerts_dedupe_key_key" ON "fraud_alerts"("dedupe_key");

-- CreateIndex
CREATE INDEX "fraud_alerts_status_severity_created_at_idx" ON "fraud_alerts"("status", "severity", "created_at");

-- CreateIndex
CREATE INDEX "fraud_alerts_user_id_created_at_idx" ON "fraud_alerts"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "fraud_alerts_account_id_created_at_idx" ON "fraud_alerts"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "fraud_alerts_transaction_id_idx" ON "fraud_alerts"("transaction_id");

-- CreateIndex
CREATE INDEX "fraud_alerts_source_created_at_idx" ON "fraud_alerts"("source", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "fraud_cases_case_number_key" ON "fraud_cases"("case_number");

-- CreateIndex
CREATE INDEX "fraud_cases_status_priority_created_at_idx" ON "fraud_cases"("status", "priority", "created_at");

-- CreateIndex
CREATE INDEX "fraud_cases_assigned_analyst_id_status_idx" ON "fraud_cases"("assigned_analyst_id", "status");

-- CreateIndex
CREATE INDEX "fraud_cases_created_by_id_created_at_idx" ON "fraud_cases"("created_by_id", "created_at");

-- CreateIndex
CREATE INDEX "fraud_case_alerts_fraud_alert_id_idx" ON "fraud_case_alerts"("fraud_alert_id");

-- CreateIndex
CREATE UNIQUE INDEX "fraud_case_alerts_fraud_case_id_fraud_alert_id_key" ON "fraud_case_alerts"("fraud_case_id", "fraud_alert_id");

-- CreateIndex
CREATE INDEX "fraud_case_notes_fraud_case_id_created_at_idx" ON "fraud_case_notes"("fraud_case_id", "created_at");

-- CreateIndex
CREATE INDEX "fraud_case_notes_author_id_created_at_idx" ON "fraud_case_notes"("author_id", "created_at");

-- CreateIndex
CREATE INDEX "fraud_case_evidence_fraud_case_id_created_at_idx" ON "fraud_case_evidence"("fraud_case_id", "created_at");

-- CreateIndex
CREATE INDEX "fraud_case_evidence_uploaded_by_id_created_at_idx" ON "fraud_case_evidence"("uploaded_by_id", "created_at");

-- CreateIndex
CREATE INDEX "fraud_case_assignments_fraud_case_id_assigned_at_idx" ON "fraud_case_assignments"("fraud_case_id", "assigned_at");

-- CreateIndex
CREATE INDEX "fraud_case_assignments_assigned_to_id_assigned_at_idx" ON "fraud_case_assignments"("assigned_to_id", "assigned_at");

-- CreateIndex
CREATE INDEX "fraud_alert_audits_fraud_alert_id_created_at_idx" ON "fraud_alert_audits"("fraud_alert_id", "created_at");

-- CreateIndex
CREATE INDEX "fraud_alert_audits_actor_id_created_at_idx" ON "fraud_alert_audits"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "fraud_case_audits_fraud_case_id_created_at_idx" ON "fraud_case_audits"("fraud_case_id", "created_at");

-- CreateIndex
CREATE INDEX "fraud_case_audits_actor_id_created_at_idx" ON "fraud_case_audits"("actor_id", "created_at");

-- AddForeignKey
ALTER TABLE "monitoring_events" ADD CONSTRAINT "monitoring_events_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitoring_events" ADD CONSTRAINT "monitoring_events_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitoring_events" ADD CONSTRAINT "monitoring_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitoring_processing_logs" ADD CONSTRAINT "monitoring_processing_logs_monitoring_event_id_fkey" FOREIGN KEY ("monitoring_event_id") REFERENCES "monitoring_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_behavior_profiles" ADD CONSTRAINT "customer_behavior_profiles_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_behavior_profiles" ADD CONSTRAINT "customer_behavior_profiles_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anomaly_detection_results" ADD CONSTRAINT "anomaly_detection_results_monitoring_event_id_fkey" FOREIGN KEY ("monitoring_event_id") REFERENCES "monitoring_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anomaly_detection_results" ADD CONSTRAINT "anomaly_detection_results_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anomaly_detection_results" ADD CONSTRAINT "anomaly_detection_results_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_predictions" ADD CONSTRAINT "fraud_predictions_monitoring_event_id_fkey" FOREIGN KEY ("monitoring_event_id") REFERENCES "monitoring_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_predictions" ADD CONSTRAINT "fraud_predictions_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_predictions" ADD CONSTRAINT "fraud_predictions_model_registry_id_fkey" FOREIGN KEY ("model_registry_id") REFERENCES "fraud_model_registry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_alerts" ADD CONSTRAINT "fraud_alerts_monitoring_event_id_fkey" FOREIGN KEY ("monitoring_event_id") REFERENCES "monitoring_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_alerts" ADD CONSTRAINT "fraud_alerts_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_alerts" ADD CONSTRAINT "fraud_alerts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_alerts" ADD CONSTRAINT "fraud_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_cases" ADD CONSTRAINT "fraud_cases_assigned_analyst_id_fkey" FOREIGN KEY ("assigned_analyst_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_cases" ADD CONSTRAINT "fraud_cases_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_case_alerts" ADD CONSTRAINT "fraud_case_alerts_fraud_case_id_fkey" FOREIGN KEY ("fraud_case_id") REFERENCES "fraud_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_case_alerts" ADD CONSTRAINT "fraud_case_alerts_fraud_alert_id_fkey" FOREIGN KEY ("fraud_alert_id") REFERENCES "fraud_alerts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_case_alerts" ADD CONSTRAINT "fraud_case_alerts_linked_by_id_fkey" FOREIGN KEY ("linked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_case_notes" ADD CONSTRAINT "fraud_case_notes_fraud_case_id_fkey" FOREIGN KEY ("fraud_case_id") REFERENCES "fraud_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_case_notes" ADD CONSTRAINT "fraud_case_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_case_evidence" ADD CONSTRAINT "fraud_case_evidence_fraud_case_id_fkey" FOREIGN KEY ("fraud_case_id") REFERENCES "fraud_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_case_evidence" ADD CONSTRAINT "fraud_case_evidence_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_case_assignments" ADD CONSTRAINT "fraud_case_assignments_fraud_case_id_fkey" FOREIGN KEY ("fraud_case_id") REFERENCES "fraud_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_case_assignments" ADD CONSTRAINT "fraud_case_assignments_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_case_assignments" ADD CONSTRAINT "fraud_case_assignments_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_alert_audits" ADD CONSTRAINT "fraud_alert_audits_fraud_alert_id_fkey" FOREIGN KEY ("fraud_alert_id") REFERENCES "fraud_alerts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_alert_audits" ADD CONSTRAINT "fraud_alert_audits_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_case_audits" ADD CONSTRAINT "fraud_case_audits_fraud_case_id_fkey" FOREIGN KEY ("fraud_case_id") REFERENCES "fraud_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_case_audits" ADD CONSTRAINT "fraud_case_audits_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
