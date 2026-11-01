# Phase 32 migration replay repair + Phase 33 schema preparation

## What is included

- `prisma/schema.prisma`: Phase 33 schema retained. `RiskAnalysis.decision` and
  `RiskAnalysis.updatedAt` now preserve the defaults introduced by the Phase 32
  migration (`APPROVE` and `CURRENT_TIMESTAMP`). This prevents the Phase 33
  preview from proposing unnecessary `DROP DEFAULT` operations.
- `prisma/migrations/20261031014006_phase32_risk_detection/migration.sql`:
  the duplicate index creation is now `CREATE INDEX IF NOT EXISTS`.
- `phase32_risk_detection.original.sql`: byte-for-byte original migration backup.
- `phase32_checksum_reconciliation.sql`: guarded script to update the two
  matching Phase 32 migration-history checksums after backup and review.
- `phase33-preview.sql`: retained from the supplied archive; it is a prior
  preview and should be regenerated after the schema update.

## Why the repair is needed

Phase 23 already creates `risk_analyses_risk_level_analyzed_at_idx`, and Phase
32 attempts to create it again. A fresh shadow database replays both migrations
and fails with PostgreSQL `42P07`. `IF NOT EXISTS` makes the Phase 32 statement
safe when Phase 23 has already created the index.

## Critical safety warning

The Phase 32 migration was already applied in Neon. Editing an applied migration
changes its checksum. Do NOT run `migrate dev` until the database's two known
Phase 32 attempt rows have been reconciled to the new checksum. The supplied
SQL script writes to Prisma's internal `_prisma_migrations` table. It is a
controlled recovery operation, not routine maintenance.

Before running it:

1. Confirm a current Neon backup / restorable point-in-time recovery.
2. Confirm you are connected to the intended Neon project/database.
3. Run a SELECT preview and verify there are exactly two Phase 32 rows with
   the original checksum, exactly one rolled back and one successfully applied.
4. Review the script. Do not run it if any count or checksum differs.
5. Execute the script in Neon SQL Editor only after the above checks.

Original checksum:
`68a625d20509e08dc784b895a49eaf74b75255d4103565efa7c3eefd7e6dada2`

Corrected migration checksum:
`8ec84d5b17674d17c64e23e79cc3a562fcc36e92454ff0c64c55adf7248214af`

## CMD workflow after approved reconciliation

From the backend root (Windows CMD):

```cmd
certutil -hashfile "prisma\migrations\20261031014006_phase32_risk_detection\migration.sql" SHA256
npx prisma migrate status
npx prisma migrate dev --name phase_33_monitoring_infrastructure --create-only
```

The file hash must equal the corrected checksum above. `migrate dev --create-only`
will replay all migrations in the shadow database; it should no longer fail on
this duplicate index. It creates a Phase 33 migration but does not apply it to
Neon. Inspect the generated SQL before applying anything.

## Phase 33 deployment

Only after the generated Phase 33 SQL has been reviewed for unintended changes,
constraints, foreign keys, indexes, and destructive statements, apply with:

```cmd
npx prisma migrate deploy
npx prisma migrate status
```

`migrate deploy` does not use shadow database replay. It applies pending
migration files; it is not a substitute for reviewing the SQL.

## Do not

- Do not run `npx prisma migrate reset` against Neon.
- Do not drop the existing index.
- Do not delete migration folders or rows from `_prisma_migrations`.
- Do not execute the checksum reconciliation script if the expected row counts
  or checksums differ.
- Do not treat `phase33-preview.sql` as an applied migration.

## Validation status

The archive was inspected and edited programmatically. Prisma CLI validation,
shadow replay, migration creation, and Neon deployment have NOT been run here.
