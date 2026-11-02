# Phase 34.1 — Performance Baseline & Monitoring

## Implemented in this source tree

- Preserves the existing Phase 31 JSON logger and HTTP request instrumentation.
- Records HTTP request count, 5xx count, average latency, maximum latency, and route-template counters.
- Enables Prisma query events and records query count, average duration, maximum duration, and slow-query count.
- Emits `database.query.slow` structured warnings when query duration is greater than or equal to `SLOW_QUERY_THRESHOLD_MS` (default: 100 ms).
- Never logs Prisma SQL text or query parameters.
- Replaces Redis connection `console` messages with structured JSON events.
- Measures Redis `PING` operations used by `/health` and `/ready`; this is a deliberately scoped measurement, not a global measurement of every Redis command.
- Exposes process uptime, RSS memory, heap used, and cumulative user/system CPU time in the existing non-production `/metrics` endpoint.
- Preserves existing production restriction on `/metrics`.

## Configuration

`SLOW_QUERY_THRESHOLD_MS=100` is optional. It must be a positive number. Configure it through the deployment environment; do not place secrets in source control.

## Metrics added

- `banking_http_latency_ms_max`
- `banking_database_queries_total`
- `banking_database_slow_queries_total`
- `banking_database_query_duration_ms_average`
- `banking_database_query_duration_ms_max`
- `banking_redis_operations_total`
- `banking_redis_operation_errors_total`
- `banking_redis_operation_duration_ms_average`
- `banking_redis_operation_duration_ms_max`
- `banking_process_uptime_seconds`
- `banking_process_resident_memory_bytes`
- `banking_process_heap_used_bytes`
- `banking_process_cpu_user_seconds_total`
- `banking_process_cpu_system_seconds_total`

## Safety and limitations

- Query instrumentation intentionally does not emit SQL text, bound parameters, request bodies, credentials, or tokens.
- Redis latency currently covers health/readiness `PING` calls only. It does not claim to measure all cache, rate-limit, or queue commands.
- Process and application metrics remain in-memory and process-local; they reset on restart and are not aggregated across instances.
- The metrics endpoint remains disabled in production until a private-network or authenticated scraping policy is configured.
- These measurements establish a baseline. They do not by themselves prove a performance improvement or production capacity.
- No database schema migration is required for this stage.

## Verification

Run focused tests:

```bat
npx vitest run src/tests/observability/metrics.test.ts
npx vitest run "src/tests/Auth&Database/requestLogging.test.ts"
npx vitest run "src/tests/Auth&Database/sensitiveDataLogging.test.ts"
```

Then run the full suite and TypeScript build from the backend root:

```bat
npm run typecheck
npm run test:run
npm run build
```

In development, request `/metrics` and verify that the new metric names appear. Generate a deliberately slow query only in an isolated test environment to verify the `database.query.slow` warning. Do not run load tests or artificial slow queries against production.
