# Phase 34.2 — PostgreSQL Index Optimization

## Scope

This change is additive. It updates `schema.prisma` and adds one new migration:
`20261102150000_phase34_2_postgresql_performance_indexes`.

It does not modify or delete any existing migration, table, column, row, constraint,
or index. Existing Prisma models and application features are preserved.

## Added indexes

| Index | Query shape supported |
|---|---|
| `transactions_source_created_id_desc_idx` | Source-account transaction history ordered by `created_at DESC, id DESC` |
| `transactions_destination_created_id_desc_idx` | Destination-account transaction history ordered by `created_at DESC, id DESC` |
| `transactions_created_id_desc_idx` | Global transaction cursor history ordered by `created_at DESC, id DESC` |
| `transactions_anomaly_history_idx` | Anomaly baseline lookup by source account, currency, completed status and time |
| `fraud_cases_created_at_desc_idx` | Recent fraud case listing ordered by creation time |
| `fraud_alerts_created_at_desc_idx` | Fraud dashboard date-range scans and recent-alert ordering |
| `monitoring_events_created_at_idx` | Monitoring-event dashboard date-range aggregation |
| `fraud_predictions_predicted_at_idx` | Fraud prediction count over a predicted-at date range |

The existing indexes are intentionally retained. Some new indexes share leading columns
with existing indexes but add deterministic ordering or a more selective compound
predicate. Their long-term value must be confirmed with query plans and write-load
measurements before considering any future index removal.

## Important limitations

- Indexes are not guaranteed to be selected by PostgreSQL. Selection depends on table
  size, data distribution, statistics, selectivity, and planner cost.
- The admin dashboard's all-time transaction `GROUP BY` is not solved merely by adding
  an index. Consider a bounded reporting period or a separately designed aggregate
  strategy only after confirming product/reporting requirements.
- This archive does not include application query rewrites. Those belong in the
  corresponding source-code phase after reviewing EXPLAIN plans and preserving result
  semantics.
- Indexes add storage and write overhead.

## Apply safely

1. Back up the target database and use a staging/test database first.
2. Ensure the Prisma schema and migration directory are the only intended changes.
3. Run:
   - `npx prisma validate`
   - `npx prisma migrate status`
   - `npx prisma migrate deploy`
   - `npx prisma migrate status`
4. Run the Phase 34.2 query-plan audit from `scripts/phase34.2-query-plan-audit.sql`.
5. Compare plans and latency before/after using representative data.

For large production tables, ordinary `CREATE INDEX` can take locks that affect writes.
Schedule the migration appropriately. If production requires `CREATE INDEX CONCURRENTLY`,
plan that as a separate operational migration procedure; do not casually edit an applied
migration or mark migrations applied without verifying the resulting indexes.

## Query-plan audit

The SQL audit is read-only (`BEGIN TRANSACTION READ ONLY` / `ROLLBACK`), but
`EXPLAIN ANALYZE` executes the SELECT statements. Run it on staging with representative
data. For production inspection, use `EXPLAIN` without `ANALYZE`, particularly for
full-table aggregates.

## Phase 34.2 status

- Schema index declarations: implemented.
- Additive migration: prepared; not applied by this archive.
- EXPLAIN plan verification: pending.
- Query optimization: pending EXPLAIN evidence.
- Before/after performance comparison: pending.
