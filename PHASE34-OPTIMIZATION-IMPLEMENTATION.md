# Phase 34 — Performance Optimization Implementation

This update applies safe, backward-compatible performance improvements and adds
load-test tooling. It does **not** mean production performance has been proven:
the test database is currently small and benchmark runs must be executed by the
project owner against isolated infrastructure.

## Scope and status

| Stage | Included in this update | Acceptance still required |
|---|---|---|
| 34.2 PostgreSQL | Existing indexes retained; Outbox locking read returns event payload in the same query; current transaction history uses bounded cursor/offset reads; audit logs use explicit relation selection; dashboard uses database `groupBy` instead of loading transaction rows | Run EXPLAIN on representative staging data and compare query timings |
| 34.3 Redis | Fixed group-index TTL shortening; cache hit/miss/write/invalidation/error counters; Redis-backed rate-limit commands contribute latency/error metrics; existing fail-open cache behavior retained | Run cache invalidation and rate-limit tests; observe hit ratio under workload |
| 34.4 API | Added gzip/deflate response compression for eligible responses >= 1 KiB; existing transaction history pagination remains bounded (max limit 100); existing Prisma `select` usage retained where present | Verify compressed responses and inspect remaining endpoint query patterns |
| 34.5 PostgreSQL concurrency | Existing configurable pool and transaction wait/timeout settings retained; documented per-process pool sizing and aggregate replica budget; existing transaction/locking semantics unchanged | Tune against actual Neon plan, API replicas and worker processes; concurrency tests |
| 34.6 Load testing | Added read-only k6 smoke and staged load scripts with local-host safety guard | Run against isolated local/staging database and Redis; capture p50/p95/p99, errors and throughput |

## Changes

### Redis cache TTL correctness

The group index TTL is now extended only when needed. A short-lived cache entry
can no longer shorten the TTL of a group index that tracks longer-lived entries.
Cache failures remain best-effort and do not turn a successful source-of-truth
read into a failed request.

### Cache metrics

Prometheus now exposes:
- `banking_cache_hits_total`
- `banking_cache_misses_total`
- `banking_cache_writes_total`
- `banking_cache_invalidations_total`
- `banking_cache_errors_total`
- `banking_cache_hit_ratio`

These counters are process-local and reset on restart, like the existing
application metrics. Do not treat them as durable accounting data.

### Rate-limit Redis instrumentation

RedisStore commands are timed and failures are counted using the existing Redis
operation metrics. Command arguments, keys, credentials and values are never
logged. The current rate-limit store error policy is preserved; do not enable
`passOnStoreError` for authentication or transfer limiters without a separate
security review.

### HTTP compression

`compression` middleware is installed before routes with a 1 KiB threshold.
Authenticated requests (Authorization/cookie headers) and authentication paths
are excluded to reduce compression side-channel exposure. Eligible public
responses are encoded only when the client advertises support. This does not
compress database values or alter monetary calculations. The
`compression` and `@types/compression` packages were added to `package.json`.

### Connection pool sizing

`DATABASE_POOL_MAX` is a per-process maximum. Calculate the deployment budget:

`(API replicas × API pool max) + (worker replicas × worker pool max) + migration/admin reserve`

Keep this below the provider's connection limit with operational headroom.
Do not blindly increase the pool. Neon pooled URLs and direct URLs have different
connection characteristics; use the provider's recommended URL for the
application workload.

### Load testing safety

`performance/k6/smoke.js` and `performance/k6/read-only.js` perform GET requests
only. They do not create deposits, withdrawals, transfers, beneficiaries or
other financial records.

By default, scripts refuse non-local hosts. To run against an isolated staging
environment, set `K6_ALLOW_NON_LOCAL=true` explicitly. Never target production
with these scripts without a separately approved test window and a production
load-test plan.

## Install and verify (Windows CMD)

1. Merge the updated `src` directory into the backend.
2. Merge the updated `package.json` into the project.
3. Install the new compression dependencies:

   `npm install`

4. Validate:

   `npm run typecheck`

   `npm run build`

5. Focused tests:

   `npx vitest run src/tests/cache/cache.service.test.ts`

   `npx vitest run src/tests/observability/metrics.test.ts`

   `npx vitest run src/tests/jobs/outbox-publisher.test.ts`

6. Full regression:

   `npm run test:run`

7. Local k6 smoke:

   `npm run load:smoke`

8. Install the k6 CLI separately (it is not an npm package), then run the
   authenticated read-only load test:

   `set K6_ACCESS_TOKEN=<TEST_USER_ACCESS_TOKEN>`

   `npm run load:read-only`

For staging, also set `K6_BASE_URL` and `K6_ALLOW_NON_LOCAL=true`. Use a
dedicated test customer and isolated test database/Redis. Do not share a real
customer token or include it in source control.

## Financial and security invariants

- PostgreSQL remains the source of truth.
- Do not cache account balances, ledger entries, transaction authorization,
  idempotency decisions, risk decisions or other financial state.
- No transfer/deposit/withdrawal business logic or isolation semantics were
  changed by this update.
- No schema migration was added or altered.
- Existing authorization and rate-limit policies were not weakened.
- No SQL parameters, request bodies, tokens or Redis command arguments are
  logged by the new instrumentation.
- Existing migration history is preserved.

## Honest completion status

Source implementation is prepared, but the stages must not be marked fully
complete until typecheck, build, focused tests, full regression tests, staging
load tests and before/after database measurements pass. Load-test results are
not included because they must be measured in the user's isolated environment.
