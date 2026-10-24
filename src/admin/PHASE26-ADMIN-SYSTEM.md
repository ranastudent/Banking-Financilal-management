# Phase 26 — Admin System

## Endpoints

All endpoints are mounted under `/api/v1`.

- `GET /admin/dashboard` — ADMIN only; read-only dashboard metrics.
- `GET /admin/users` and `GET /admin/users/:userId` — existing user listing/details.
- `PATCH /admin/users/:userId/status` — existing admin user status operation.
- `GET /admin/accounts` and `GET /admin/accounts/:accountId` — existing account listing/details.
- `GET /admin/transactions` and `GET /admin/transactions/:transactionId` — existing transaction listing/details.
- `GET /admin/audit-logs` and `GET /admin/audit-logs/:auditLogId` — existing audit-log listing/details; the existing ADMIN/AUDITOR access policy is preserved.

## Dashboard metric definitions

- `totalUsers`: all users.
- `totalAccounts`: all accounts.
- `totalDeposits`: completed `DEPOSIT` and `EXTERNAL_DEPOSIT` transactions; count and amount grouped by currency.
- `totalWithdrawals`: completed `WITHDRAWAL` transactions; count and amount grouped by currency.
- `totalTransfers`: completed `INTERNAL_TRANSFER` and `EXTERNAL_TRANSFER` transactions; count and amount grouped by currency.
- `failedTransactions`: all transactions with `FAILED` status.
- `pendingTransactions`: transactions in either `PENDING` or `PROCESSING` status.
- `blockedUsers`: users with `BLOCKED` status.
- `frozenAccounts`: accounts with `FROZEN` status.
- `blockedAccounts`: compatibility metric that currently reports frozen-account count because the schema has `FROZEN`, not `BLOCKED`, as an account status.

Monetary values are returned as decimal strings and grouped by currency to avoid combining unlike currencies or introducing JavaScript floating-point errors. The dashboard is read-only and uses the existing Prisma models; no schema migration is required.

## Tests

Run the focused tests from the project root:

```bash
npx vitest run src/tests/admin/admin-dashboard.test.ts
```

The test file mocks Prisma for deterministic metric and route authorization tests. Run the full suite afterward to check for regressions:

```bash
npm run typecheck
npm run test:run
```
