# Phase 33 Fraud Monitoring Implementation

This source bundle adds the Phase 33 application layer and Phase 33.7 customer
decision explanations. It reuses the existing Prisma models deployed in Neon.
It does not include a database migration.

## Implemented application components

- 33.1 Monitoring ingestion, stable event keys, BullMQ processing, processing
  logs, retry/dead-letter state and retrospective transfer event capture.
- 33.2 Rolling 30-day and 90-day account/currency behaviour profiles.
- 33.3 Advisory transfer-amount z-score anomaly detection (requires at least
  ten prior completed transfers in the same account/currency).
- 33.4 Optional HTTP inference adapter. A separately trained, evaluated and
  deployed model service is required; no trained model is bundled.
- 33.5 Fraud alerts, status audit, case creation, notes, assignments, evidence
  references and case audit.
- 33.6 Admin dashboard aggregation API.
- 33.7 Customer-safe explanation history for Phase 32 holds/reviews and Phase
  33 retrospective alerts.

## Routes

All routes are mounted under `/api/v1`.

### Admin monitoring
- `POST /admin/monitoring/events` — manually ingest an event (ADMIN).
- `POST /admin/monitoring/events/:eventId/reprocess` — reprocess an event (ADMIN).

### Admin fraud operations
- `GET /admin/fraud/alerts`
- `PATCH /admin/fraud/alerts/:alertId` body `{ "status": "...", "comment": "..." }`
- `POST /admin/fraud/alerts/:alertId/cases`
- `GET /admin/fraud/cases`
- `POST /admin/fraud/cases/:caseId/notes` body `{ "body": "...", "isInternal": true }`
- `POST /admin/fraud/cases/:caseId/evidence` body includes an approved private
  `storageRef`, `evidenceType`, and optional metadata. This records a storage
  reference; it does not upload files.
- `POST /admin/fraud/cases/:caseId/assignments` body `{ "assignedToId": "...", "reason": "..." }`
- `PATCH /admin/fraud/cases/:caseId` body `{ "status": "...", "comment": "...", "resolution": "..." }`
- `GET /admin/fraud/dashboard`

### ML model registry (ADMIN)
- `GET /admin/fraud-models`
- `POST /admin/fraud-models` — create a DRAFT model (requires name, version,
  featureSchemaVersion; SHA-256 artifact checksum recommended).
- `PATCH /admin/fraud-models/:modelId/lifecycle` with action `VALIDATE`,
  `APPROVE`, `DEPLOY`, `DISABLE` or `RETIRE`. Approval requires evaluation
  metrics and an artifact checksum; deployment is restricted to APPROVED
  models and disables the previous deployment.

### Customer explanations
- `GET /customer/decision-explanations/me?page=1&limit=20`

All admin routes require authenticated ADMIN role. Customer explanations are
scoped to the authenticated user's ID.

## Environment variables for optional ML inference

```env
FRAUD_MODEL_INFERENCE_URL=
FRAUD_MODEL_API_KEY=
FRAUD_MODEL_TIMEOUT_MS=2500
FRAUD_ALERT_THRESHOLD=0.85
```

Do not expose the model API key to a browser/client. The model service must
validate its own request authentication and return `fraudProbability` between
0 and 1. Predictions are advisory evidence only. They do not block, approve,
reject, hold, release, reverse, or move funds.

## Financial safety semantics

- Phase 32 risk assessment is preventive: an ON_HOLD decision is recorded
  before ledger postings. Customer copy checks the ledger rather than assuming
  fund movement from the risk score.
- Phase 33 monitoring is retrospective for committed transfers. A monitoring
  alert does not change the transaction status or balance.
- A completed transaction with ledger entries is described as completed and
  flagged for review, not as stopped before transfer.
- The decision-explanation subsystem is read/communication history only.
- Phase 33 workers must run alongside the existing background worker.

## Operational limitations / production hardening

- The supplied source archive did not include the frontend. Stage 33.6 here is
  backend dashboard APIs, not a browser dashboard UI.
- ML inference is an adapter only. Model training, dataset governance,
  independent validation, drift monitoring, model approval and rollback still
  need a separately developed ML lifecycle.
- Current statistical detector is a transparent baseline (z-score), not a
  validated fraud classifier. Thresholds require calibration against
  representative, appropriately governed data.
- Transfer monitoring is wired through the existing TRANSFER_COMMITTED job.
  Deposit, withdrawal, FX and external-provider event producers should emit
  equivalent durable monitoring events after their authoritative transaction
  commit; do not infer their state from API request attempts.
- Configure alert/case permissions, analyst roles, evidence storage retention,
  privacy controls, operational SLAs, alert escalation and audit retention
  before production use.
- Do not use this implementation as regulatory or production certification.
