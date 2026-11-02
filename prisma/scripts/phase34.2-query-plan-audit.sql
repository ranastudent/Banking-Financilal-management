-- Phase 34.2: PostgreSQL query-plan audit
-- Run against an isolated staging/test database with representative data.
-- EXPLAIN ANALYZE executes each SELECT. Do NOT run the full-table sections
-- against production during peak traffic. For production, remove ANALYZE and
-- use EXPLAIN (BUFFERS, VERBOSE, SETTINGS) only.
-- Replace the sample UUID/date literals if you want representative selectivity.
-- This script is read-only and does not create/drop/alter any database objects.

BEGIN TRANSACTION READ ONLY;

-- 1. Global transaction history (cursor pagination shape)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)
SELECT t.*
FROM transactions AS t
ORDER BY t.created_at DESC, t.id DESC
LIMIT 51;

-- 2. Transaction history by source account (cursor pagination shape)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)
SELECT t.*
FROM transactions AS t
WHERE t.source_account_id = '00000000-0000-4000-8000-000000000001'::uuid
ORDER BY t.created_at DESC, t.id DESC
LIMIT 51;

-- 3. Transaction history by destination account (cursor pagination shape)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)
SELECT t.*
FROM transactions AS t
WHERE t.destination_account_id = '00000000-0000-4000-8000-000000000001'::uuid
ORDER BY t.created_at DESC, t.id DESC
LIMIT 51;

-- 4. Transaction ownership through transaction legs (EXISTS relation filter)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)
SELECT t.id, t.created_at
FROM transactions AS t
WHERE EXISTS (
  SELECT 1
  FROM transaction_legs AS tl
  WHERE tl.transaction_id = t.id
    AND tl.account_id = '00000000-0000-4000-8000-000000000001'::uuid
)
ORDER BY t.created_at DESC, t.id DESC
LIMIT 51;

-- 5. Transaction ownership through ledger entries (EXISTS relation filter)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)
SELECT t.id, t.created_at
FROM transactions AS t
WHERE EXISTS (
  SELECT 1
  FROM ledger_entries AS le
  WHERE le.transaction_id = t.id
    AND le.account_id = '00000000-0000-4000-8000-000000000001'::uuid
)
ORDER BY t.created_at DESC, t.id DESC
LIMIT 51;

-- 6. Admin transaction dashboard aggregation (full-table aggregate).
-- Run only on staging with representative volume; otherwise use EXPLAIN without ANALYZE.
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)
SELECT type, status, currency_code,
       COUNT(*) AS transaction_count,
       SUM(amount) AS total_amount
FROM transactions
GROUP BY type, status, currency_code;

-- 7. Fraud dashboard: alert counts by status for a date range
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)
SELECT status, COUNT(*)
FROM fraud_alerts
WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
  AND created_at <= CURRENT_TIMESTAMP
GROUP BY status;

-- 8. Fraud dashboard: recent alerts
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)
SELECT id, title, severity, status, source, created_at, transaction_id
FROM fraud_alerts
WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
  AND created_at <= CURRENT_TIMESTAMP
ORDER BY created_at DESC
LIMIT 20;

-- 9. Fraud dashboard: monitoring event health by status
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)
SELECT status, COUNT(*)
FROM monitoring_events
WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
  AND created_at <= CURRENT_TIMESTAMP
GROUP BY status;

-- 10. Fraud dashboard: prediction count by predicted_at
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)
SELECT COUNT(*)
FROM fraud_predictions
WHERE predicted_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
  AND predicted_at <= CURRENT_TIMESTAMP;

ROLLBACK;
