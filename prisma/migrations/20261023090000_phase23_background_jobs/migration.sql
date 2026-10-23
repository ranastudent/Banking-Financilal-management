-- Phase 23: transactional outbox and durable background-job results.
CREATE TYPE "OutboxEventStatus" AS ENUM ('PENDING', 'PUBLISHED');

ALTER TABLE "notifications"
  ADD COLUMN "dedupe_key" TEXT;

CREATE UNIQUE INDEX "notifications_dedupe_key_key"
  ON "notifications"("dedupe_key");

CREATE TABLE "outbox_events" (
  "id" UUID NOT NULL,
  "event_type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "OutboxEventStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "published_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "outbox_events_status_created_at_idx"
  ON "outbox_events"("status", "created_at");

CREATE TABLE "background_reports" (
  "id" UUID NOT NULL,
  "report_type" TEXT NOT NULL,
  "dedupe_key" TEXT NOT NULL,
  "period_start" TIMESTAMP(3) NOT NULL,
  "period_end" TIMESTAMP(3) NOT NULL,
  "payload" JSONB NOT NULL,
  "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "background_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "background_reports_dedupe_key_key"
  ON "background_reports"("dedupe_key");
CREATE INDEX "background_reports_report_type_generated_at_idx"
  ON "background_reports"("report_type", "generated_at");

CREATE TABLE "risk_analyses" (
  "id" UUID NOT NULL,
  "transaction_id" UUID NOT NULL,
  "risk_level" TEXT NOT NULL,
  "reasons" JSONB NOT NULL,
  "analyzed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "risk_analyses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "risk_analyses_transaction_id_key"
  ON "risk_analyses"("transaction_id");
CREATE INDEX "risk_analyses_risk_level_analyzed_at_idx"
  ON "risk_analyses"("risk_level", "analyzed_at");

ALTER TABLE "risk_analyses"
  ADD CONSTRAINT "risk_analyses_transaction_id_fkey"
  FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
