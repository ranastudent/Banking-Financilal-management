-- Phase 25: add request correlation and outcome fields to audit logs.
-- Existing audit rows are retained; success defaults to true for historical records.
ALTER TABLE "audit_logs"
  ADD COLUMN "request_id" TEXT,
  ADD COLUMN "success" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "failure_reason" TEXT;

CREATE INDEX "audit_logs_request_id_idx"
  ON "audit_logs"("request_id");
