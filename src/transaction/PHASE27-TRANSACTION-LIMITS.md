# Phase 27 — Transaction Limits

## Configuration

The following environment variables are optional and have validated defaults:

- `TRANSACTION_LIMIT_TIME_ZONE=Asia/Dhaka`
- `DAILY_WITHDRAWAL_LIMIT=100000.00`
- `DAILY_TRANSFER_LIMIT=100000.00`
- `TRANSFER_MAX_AMOUNT=50000.00`
- `TRANSFER_MIN_AMOUNT=1.00`

`WITHDRAWAL_MAX_AMOUNT` remains in place and continues to control the maximum amount of a single withdrawal. The daily withdrawal limit is a separate rule.

## Calculation rules

- Limits are scoped to the source account, currency, and local calendar day in the configured IANA timezone.
- Amounts are compared and summed with Prisma Decimal, not JavaScript floating-point arithmetic.
- Completed internal and external transfers count toward the daily transfer limit.
- Pending, processing, and completed withdrawals count toward the daily withdrawal limit because the existing withdrawal flow debits the available balance when the withdrawal is created.
- Failed and cancelled transactions do not count.
- The transfer service checks the single-transfer floor/ceiling before processing, then checks daily usage after the source balance row has been locked.
- The withdrawal service checks daily usage after locking the account's currency balance.
- Existing account-balance row locks serialize concurrent outgoing transactions for the same account and currency. The daily total is queried inside the same database transaction as the debit/transfer, so rejected requests roll back without partial balance changes.

## API behavior

A violation raises the existing `TRANSACTION_LIMIT_EXCEEDED` application error with HTTP status `409`. No route or request schema change is required.

## Verification

Run:

```bash
npx vitest run src/tests/transaction-limits
npx vitest run src/tests/account/withdrawal-transaction-limit.test.ts
npx vitest run src/tests/transfer
npm run typecheck
npm run test:run
```
