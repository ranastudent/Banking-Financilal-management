-- Phase 34.2: additive PostgreSQL performance indexes.
-- These indexes support observed query shapes in transaction history,
-- anomaly detection, and fraud/monitoring dashboards.
-- No existing indexes, tables, rows, or migration history are modified.

CREATE INDEX IF NOT EXISTS "transactions_source_created_id_desc_idx"
ON "transactions" ("source_account_id", "created_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "transactions_destination_created_id_desc_idx"
ON "transactions" ("destination_account_id", "created_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "transactions_created_id_desc_idx"
ON "transactions" ("created_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "transactions_anomaly_history_idx"
ON "transactions" ("source_account_id", "currency_code", "status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "fraud_cases_created_at_desc_idx"
ON "fraud_cases" ("created_at" DESC);

CREATE INDEX IF NOT EXISTS "fraud_alerts_created_at_desc_idx"
ON "fraud_alerts" ("created_at" DESC);

CREATE INDEX IF NOT EXISTS "monitoring_events_created_at_idx"
ON "monitoring_events" ("created_at");

CREATE INDEX IF NOT EXISTS "fraud_predictions_predicted_at_idx"
ON "fraud_predictions" ("predicted_at");
