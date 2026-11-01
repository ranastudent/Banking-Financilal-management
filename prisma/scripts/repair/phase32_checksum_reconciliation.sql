-- CONTROLLED REPAIR ONLY. REVIEW README BEFORE RUNNING.
-- This reconciles the two already-recorded attempts for the exact Phase 32
-- migration after making its duplicate index creation idempotent.
-- It changes ONLY the checksum field in _prisma_migrations.
-- Run only after a verified Neon backup/restore point and independent review.

BEGIN;

DO $$
DECLARE
  matching_rows INTEGER;
  updated_rows INTEGER;
BEGIN
  SELECT COUNT(*) INTO matching_rows
  FROM "_prisma_migrations"
  WHERE "migration_name" = '20261031014006_phase32_risk_detection'
    AND "checksum" = '68a625d20509e08dc784b895a49eaf74b75255d4103565efa7c3eefd7e6dada2';

  IF matching_rows <> 2 THEN
    RAISE EXCEPTION 'Aborting: expected exactly 2 original Phase 32 rows, found %', matching_rows;
  END IF;

  IF (
    SELECT COUNT(*) FROM "_prisma_migrations"
    WHERE "migration_name" = '20261031014006_phase32_risk_detection'
      AND "checksum" = '68a625d20509e08dc784b895a49eaf74b75255d4103565efa7c3eefd7e6dada2'
      AND "rolled_back_at" IS NOT NULL AND "finished_at" IS NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'Aborting: expected exactly one rolled-back Phase 32 attempt';
  END IF;

  IF (
    SELECT COUNT(*) FROM "_prisma_migrations"
    WHERE "migration_name" = '20261031014006_phase32_risk_detection'
      AND "checksum" = '68a625d20509e08dc784b895a49eaf74b75255d4103565efa7c3eefd7e6dada2'
      AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'Aborting: expected exactly one successful Phase 32 attempt';
  END IF;

  UPDATE "_prisma_migrations"
  SET "checksum" = '8ec84d5b17674d17c64e23e79cc3a562fcc36e92454ff0c64c55adf7248214af'
  WHERE "migration_name" = '20261031014006_phase32_risk_detection'
    AND "checksum" = '68a625d20509e08dc784b895a49eaf74b75255d4103565efa7c3eefd7e6dada2';

  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  IF updated_rows <> 2 THEN
    RAISE EXCEPTION 'Aborting: expected to update 2 checksums, updated %', updated_rows;
  END IF;
END $$;

COMMIT;
