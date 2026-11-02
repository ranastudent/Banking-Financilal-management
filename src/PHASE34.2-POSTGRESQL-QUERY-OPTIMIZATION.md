# Phase 34.2 — PostgreSQL Query Optimization

## Scope of this source update

This update applies a targeted query-round-trip reduction to the Outbox publisher.
It does not alter database schema, Prisma migrations, transaction semantics, queue
job identifiers, retry behavior, or the public API.

## Change: Outbox row-lock read

File: `src/jobs/outbox-publisher.ts`

Before this update, each candidate event was handled with:
1. A bounded Prisma `findMany` to select pending event IDs.
2. A `SELECT ... FOR UPDATE SKIP LOCKED` query to lock the candidate.
3. A separate Prisma `findUnique` query to retrieve `eventType` and `payload`.
4. An update to mark the event published or record a retry attempt.

The lock query now retrieves `id`, `event_type`, and `payload` together. The
separate `findUnique` round-trip is removed.

The row is still selected only when `status = 'PENDING'`, and the lock still uses
`FOR UPDATE SKIP LOCKED`. The event is still processed and updated inside the
same per-event database transaction. Stable queue IDs and existing retry logic
are unchanged.

### Expected effect

For each candidate that is successfully locked and processed, this removes one
database read round-trip. It does not guarantee a specific millisecond improvement;
measure against representative data and the same database/network conditions.

## Indexes

The eight Phase 34.2 indexes added by the Prisma migration are database changes
and are not recreated by this source ZIP. The database owner reported that all
eight indexes exist in PostgreSQL.

The Outbox table already has:
`outbox_events_status_created_at_idx (status, created_at)`

The observed PENDING query used this index through a Bitmap Index Scan. PostgreSQL
then sorted the matching rows. With the currently reported table size (911 rows),
the observed execution time was about 3.193 ms. This is not evidence that another
index is needed. PostgreSQL may correctly prefer a bitmap scan plus sort for a
small table.

## Safety preserved

- Per-event `FOR UPDATE SKIP LOCKED` locking remains.
- Pending-status predicate remains in the locking SQL.
- The per-event transaction boundary remains.
- Queue submission still occurs before marking the event PUBLISHED.
- Partial queue submission failures remain retryable using stable queue job IDs.
- No transaction, ledger, balance, idempotency, audit, or authorization behavior
  is intentionally changed.
- No SQL parameters or sensitive payload values are logged by this optimization.

## Tests updated

`src/tests/jobs/outbox-publisher.test.ts` now mocks the row-lock query as the
source of the event data and verifies that the locking SQL selects the event type
and retains `FOR UPDATE SKIP LOCKED`.

Run from the backend root:

```bat
npx vitest run src/tests/jobs/outbox-publisher.test.ts
npm run typecheck
npm run test:run
npm run build
```

## Completion criteria still requiring execution evidence

The code change is prepared, but this archive has not been executed against the
user's local dependencies/database. Phase 34.2 should be marked fully verified
only after:
1. Focused Outbox tests pass.
2. TypeScript typecheck and production build pass.
3. Full regression suite passes.
4. Representative before/after query measurements are recorded.
5. Relevant EXPLAIN plans are reviewed for the actual high-volume queries
   (transactions, audit logs, outbox and dashboards).

Do not force index usage with `enable_seqscan = OFF` in production. Do not add
indexes solely because `idx_scan` is zero on a small or newly indexed dataset.
