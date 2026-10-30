# Phase 31 — Observability (initial implementation)

## Implemented in this source tree

- JSON structured logs for request start/completion and unexpected request failures.
- Request ID, authenticated user ID (when available), HTTP method, route endpoint, status, latency, and timestamp in completion logs.
- Query strings and request bodies are deliberately excluded from request logs to reduce accidental credential/PII leakage.
- Counters for HTTP requests, HTTP 5xx responses, average request latency, transfer successes/failures, final background-job failures, and database-related unexpected errors.
- Prometheus text-format metrics endpoint at `GET /metrics` in non-production environments.
- Transfer success/failure logs include request ID and user ID; success logs include transaction ID, not transfer amounts or tokens.
- Background worker failures are logged as structured events; queue-failure metric increments on final job failure rather than every retry attempt.

## Local smoke test

1. Start the API as usual.
2. Make a few requests to Swagger at `http://localhost:<PORT>/api-docs`.
3. Open `http://localhost:<PORT>/metrics` in a development environment.
4. Confirm counters such as `banking_http_requests_total`, `banking_http_latency_ms_average`, `banking_transfer_success_total`, `banking_transfer_failure_total`, `banking_queue_failures_total`, and `banking_database_errors_total` are present.
5. Make a successful request and an expected failing request, then refresh `/metrics` and verify counters change.

## Automated tests

- `src/tests/observability/metrics.test.ts` checks the Prometheus output, HTTP/error counters, transfer/queue/database counters, and route-label normalization.
- `src/tests/Auth&Database/requestLogging.test.ts` checks the JSON structured completion log emitted by the request logger.
- Run these tests using the repository's existing Vitest test script/configuration. This source-only ZIP does not include the root package manifest or Vitest configuration, so the test command must be taken from the full backend repository.

## Important limitations / production follow-up

- Metrics are in-memory process counters: they reset on restart and are not aggregated across multiple API instances. Use a shared metrics backend or Prometheus client/registry for multi-instance production deployment.
- `/metrics` is intentionally disabled in production in this initial step so metrics are not exposed publicly without an access policy. Before production, expose it only to a private network or add authentication/allowlisting for the scraper.
- The database-error counter captures unexpected errors identifiable as Prisma/database errors in the global error handler; errors handled and swallowed inside a service are not automatically counted.
- Request and transfer counters are process-local and are not a substitute for durable financial audit logs. The audit log remains the source of record for financial actions.
- This source ZIP does not contain the root package manifest, lockfile, Prisma schema/migrations, or full repository configuration. A full TypeScript build and automated test suite could not be run from this archive alone.


# Test setup for Phase 31 and database integration tests

## Structured logging tests

`src/tests/Auth&Database/sensitiveDataLogging.test.ts` now spies on `console.info`,
because the JSON logger emits informational records through `console.info`. It checks
that safe request metadata is logged while request bodies and query-string secrets
are not logged.

## Missing BDT reference data

Some integration tests create account balances with `currencyCode: "BDT"`. The
foreign-key failures in the test output mean that the database used by those tests
does not contain the required currency row. This is test-database reference data,
not a reason to disable foreign-key constraints.

An opt-in setup file is provided at `src/tests/setup.ts`. It creates or reactivates
BDT only when both `NODE_ENV=test` and `ENABLE_TEST_REFERENCE_DATA_SEED=true`.

**Safety:** Before enabling this, verify that `DATABASE_URL` points to a dedicated
test database, not production or a database containing valuable data.

Add the setup file to the existing root Vitest configuration:

```ts
test: {
  setupFiles: ["./src/tests/setup.ts"],
}
```

Preserve any existing `test` options in your configuration; merge `setupFiles`
into the existing object rather than replacing it.

Set `ENABLE_TEST_REFERENCE_DATA_SEED=true` only in the test command/environment.
For Windows Command Prompt:

```bat
set NODE_ENV=test
set ENABLE_TEST_REFERENCE_DATA_SEED=true
npx vitest run
```

The source-only ZIP does not include the root `vitest.config.ts`/`vite.config.ts`
or `package.json`, so those root-level files must be updated in your local project.
Do not use `prisma migrate reset` as a shortcut for this issue.
