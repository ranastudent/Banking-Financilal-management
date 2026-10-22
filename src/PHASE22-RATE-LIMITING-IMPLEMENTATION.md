# Phase 22 — API-Specific Rate Limiting

## Summary
Added a dedicated Redis-backed rate limiter for transaction-history/read endpoints while preserving the existing general, authentication, OTP, and transfer limiters.

## Default policy

| API category | Window | Limit |
|---|---:|---:|
| General/public baseline | 15 minutes | 100 requests |
| Login and other authentication endpoints | 15 minutes | 10 requests |
| OTP-related endpoints | 10 minutes | 5 requests |
| Fund transfers | 15 minutes | 20 requests |
| Transaction history and transaction read endpoints | 15 minutes | 60 requests |

The general limiter remains globally applied in `src/app.ts`. Category-specific limiters add separate Redis counters, so the general limit remains a baseline rather than being replaced.

## Files updated

1. `src/config/env.ts`
   - Added `env.rateLimit.transactionHistory` configuration.
   - Reads `TRANSACTION_HISTORY_RATE_LIMIT_WINDOW_MS` and `TRANSACTION_HISTORY_RATE_LIMIT_MAX`.
   - Defaults to 15 minutes and 60 requests.

2. `src/middleware/rateLimiter.ts`
   - Added `transactionHistoryRateLimiter`.
   - Uses the existing Redis store factory and its own `rl:transaction-history:` prefix.
   - Returns HTTP 429 with code `TRANSACTION_HISTORY_RATE_LIMIT_EXCEEDED`, a readable message, and `requestId`.

3. `src/transaction/routes/transaction.routes.ts`
   - Added the transaction-history limiter to the authenticated transaction list and single-transaction read routes.
   - Preserved the existing transfer limiter.

4. `src/admin/routes/transaction.routes.ts`
   - Added the transaction-history limiter to admin transaction list and detail routes.

5. `src/auditor/routes/transaction.routes.ts`
   - Added the transaction-history limiter to auditor transaction list and detail routes.

6. `src/support/routes/transaction.routes.ts`
   - Added the transaction-history limiter to support's customer transaction-history route.

7. `src/.env.example`
   - Documented the two new transaction-history rate-limit environment variables.

8. `src/tests/Auth&Database/rateLimit.test.ts`
   - Added a test that checks the transaction-history limit and verifies the 429 response payload.
   - Uses an isolated Express test app and a distinct test IP to avoid consuming the application's general rate-limit bucket.

## Files created

- `src/PHASE22-RATE-LIMITING-IMPLEMENTATION.md` — this implementation report.

## Existing behavior preserved

- General rate limiting remains installed globally in `src/app.ts`.
- Authentication, OTP, and transfer limiters remain in place.
- Existing Redis connection handling and rate-limit response conventions are reused.
- No database schema or financial transaction logic was changed.

## Validation status

- Source archive integrity was checked after packaging.
- TypeScript compilation and Vitest were not executed in this packaging environment because the uploaded ZIP contains the `src/` tree but not the project's root package manifest and installed dependencies.
- Run the checks below from the project root, where `package.json` and dependencies are available:

```bash
npm run typecheck
npx vitest run "src/tests/Auth&Database/rateLimit.test.ts"
npx vitest run
```

## Configuration

Add these variables to the application's runtime environment if you want to override the defaults:

```env
TRANSACTION_HISTORY_RATE_LIMIT_WINDOW_MS=900000
TRANSACTION_HISTORY_RATE_LIMIT_MAX=60
```

The limiter uses the default `express-rate-limit` client-IP keying. If the application runs behind a reverse proxy, configure Express `trust proxy` to match the actual trusted proxy topology; do not blindly trust arbitrary forwarded headers.
