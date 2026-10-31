# Phase 32 — Risk Detection and Review

## Scope

This implementation adds a rules-based pre-transfer risk gate to the existing modular monolith. It does not introduce a separate microservice or an ML runtime.

## Risk rules and scoring

| Rule | Score | Trigger |
|---|---:|---|
| Large transfer | 40 | Amount >= `RISK_LARGE_TRANSFER_THRESHOLD` (default 25000) |
| Transfer velocity | 35–40 | >= 3 attempts in a minute, or >= 8 in an hour |
| New beneficiary | 20 | Recipient account is not an active saved beneficiary |
| Recent failed attempts | 20–35 | >= 3 failed transactions in the last hour |
| Unusual pattern | 20–30 | Amount >= 3x recent completed-transfer average, or >= 25000 between 00:00–04:59 local server time |

Scores are capped at 100. Scores >= 60 produce `HIGH` / `HOLD`; lower scores produce `LOW` / `APPROVE`. These are deterministic policy scores, not calibrated fraud probabilities. Rules implement the `RiskRule` contract and can be added without changing the engine.

## Transfer guarantees

- Risk assessment is executed before the existing financial Prisma transaction starts.
- A `HOLD` creates a transaction with `ON_HOLD`, a durable `RiskAnalysis`, audit record, outbox notification request, and idempotency response in one database transaction.
- The hold path does not debit/credit balances and does not create ledger entries or transaction legs.
- A Redis velocity dependency failure fails closed with HTTP 503; it does not silently classify a transfer as low risk.
- `LOW` transfers continue through the existing transfer service; their risk analysis is persisted in the same financial transaction as the transfer and ledger.
- Admin review endpoints are ADMIN-only.
- Approval calls the existing `prepareTransfer` service. It locks the original held transaction inside the same financial transaction that posts balances/ledger and creates the review record. The original hold is transitioned to `CANCELLED` as the historical review envelope; the newly executed transfer is the completed financial transaction.
- Rejection transitions the held transaction to `CANCELLED`, sets review status to `REJECTED`, and creates an immutable review/audit record.
- The retrospective Phase 23 risk worker no longer overwrites a synchronous Phase 32 assessment.

## API

- `GET /api/v1/admin/risk-reviews?page=1&limit=20`
- `GET /api/v1/admin/risk-reviews/:riskAnalysisId`
- `POST /api/v1/admin/risk-reviews/:riskAnalysisId/decision`

Request body:

```json
{
  "decision": "APPROVED",
  "comment": "Reviewed supporting information"
}
```

`decision` must be `APPROVED` or `REJECTED`. Only ADMIN may access these endpoints.

## Operational notes

- Redis velocity keys use expiring minute/hour buckets.
- Configure `RISK_LARGE_TRANSFER_THRESHOLD` to a positive amount appropriate to the deployment's base currency. The current default is 25000 and should be reviewed before production.
- Redis is currently required for transfer risk assessment; ensure Redis availability and monitoring.
- `UnusualPatternRule` uses the configured `TRANSACTION_LIMIT_TIME_ZONE` business timezone (default `Asia/Dhaka`).
- Failed-attempt detection counts persisted `FAILED` transaction rows; failures that never create a transaction row are not included in that rule.
- This package is a source-only update. Run the project's normal typecheck, unit tests, and integration/security tests in the backend repository before deployment.

## Phase 32 integration verification

The dedicated database-backed integration suite is:

- `src/tests/risk/risk-transfer-review.integration.test.ts`

It verifies the following acceptance criteria against the isolated test PostgreSQL database and test Redis instance:

1. A transfer meeting the configured large-transfer threshold and going to a recipient who is not an active saved beneficiary is classified `HIGH` / `HOLD`.
2. The transfer is persisted as `ON_HOLD` before any debit/credit, ledger entry, or transaction leg is created; sender and receiver balances remain unchanged.
3. An ADMIN can reject a held transfer; the hold is closed as `CANCELLED`, the risk review is `REJECTED`, and balances remain unchanged.
4. An ADMIN can approve a held transfer through the existing transfer service; exactly one completed transfer is posted and the held record is marked reviewed.
5. A repeated approval is rejected with HTTP 409 and does not move money a second time.
6. An authenticated non-admin cannot access the admin risk-review endpoint (HTTP 403).

Run the focused suite from the backend project root:

```bash
npm run test:run -- src/tests/risk/risk-transfer-review.integration.test.ts
```

Then run all risk tests:

```bash
npm run test:run -- src/tests/risk/
```

Finally run the complete regression suite:

```bash
npm run test:run
```

These are integration tests and require `NODE_ENV=test`, the dedicated test database identified by `TEST_DATABASE_NAME`, and the isolated Redis endpoint verified by `src/tests/setup.ts`. The fixture uses the configured `RISK_LARGE_TRANSFER_THRESHOLD` and requires it to be positive and no greater than `TRANSFER_MAX_AMOUNT`. Never run these tests against production infrastructure.

A successful test run is evidence for the tested paths, not a substitute for deployment-specific security review, load testing, monitoring, and review of risk thresholds before production.
