# Backend update notes

This update focuses on making the test run deterministic and reducing false failures caused by test discovery and shared test data.

## Changes

- Added `vitest.config.ts` so Vitest runs tests under `src/` only and does not also discover compiled copies under `dist/`.
- Made `npm test` a one-shot run (`vitest run`) and added `npm run test:watch` for interactive watch mode.
- Limited test-file parallelism and increased test/hook timeouts to 15 seconds to reduce connection pressure on database-backed integration tests.
- Added `src/tests/helpers/unused-currency.ts` and updated missing-currency tests to choose a currency code that is absent from the test database instead of assuming `ZZZ` is unused.

## Verification status

The archive supplied for this update contained no usable generated Prisma client/runtime, and the environment could not download Prisma's schema engine. There was also no safe, isolated test database configured for this run. Therefore, the full database-backed test suite and TypeScript typecheck could not be verified here. Run `npm ci`, configure a dedicated test database using `.env.example`, run `npx prisma generate`, apply migrations to that test database, then run `npm run typecheck` and `npm test`.

**Security note:** the supplied `.env` file is intentionally not included in this ZIP. Recreate local environment settings from `.env.example`; do not share or commit real credentials.
