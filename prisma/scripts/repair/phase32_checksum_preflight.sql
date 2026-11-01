-- READ ONLY: verify the two Phase 32 migration records before reconciliation.
SELECT migration_name, checksum, finished_at, rolled_back_at
FROM "_prisma_migrations"
WHERE migration_name = '20261031014006_phase32_risk_detection'
ORDER BY started_at;
