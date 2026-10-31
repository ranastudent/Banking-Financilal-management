# Dedicated Neon + Redis test environment

## Why this is required

The integration-test setup writes reference currency rows and test suites perform
database and Redis operations. Do not point tests at production infrastructure.

## 1. Create an isolated Neon database

1. In the Neon Console, create a dedicated test project or a branch named
   `banking-platform-test`.
2. IMPORTANT: create it from an empty/schema-only branch. A Neon branch created
   from production inherits the parent's data at branch creation time. Do not
   clone production data for this test environment.
3. Copy the test branch connection string. Record its hostname and database name.
4. Apply the project's existing Prisma migrations to this test database:
   `npx prisma migrate deploy`
   Run this command with `DATABASE_URL` loaded from the test environment only.
5. Verify the database name and branch hostname before running tests.

## 2. Create isolated Redis

Create a separate Redis instance/service for testing. Do not reuse the production
Redis endpoint. Copy its connection URL and hostname.

This implementation verifies the configured Redis hostname and sends PING before
the shared integration setup seeds currencies. A separate instance is preferred
over relying on a key prefix because existing application code may use multiple
Redis clients or key patterns.

## 3. Configure `.env.test`

Copy `src/.env.test.example` to the PROJECT ROOT as `.env.test`.
Replace every placeholder. Host variables must be hostnames only, without scheme,
port, username, password, or path.

- `DATABASE_URL`: test Neon connection string.
- `TEST_DATABASE_NAME`: exact database name in that connection string.
- `TEST_DATABASE_HOST`: exact test Neon hostname.
- `REDIS_URL`: dedicated test Redis URL.
- `TEST_REDIS_HOST`: exact test Redis hostname.
- `PRODUCTION_DATABASE_HOST` and `PRODUCTION_REDIS_HOST`: production hostnames,
  used only for comparison and never for test connections.

Keep `.env.test` out of Git.

## 4. Load `.env.test` when running Vitest

Node 22 supports `--env-file`. Update the root `package.json` scripts to:

```json
{
  "test": "node --env-file=.env.test ./node_modules/vitest/vitest.mjs run",
  "test:run": "node --env-file=.env.test ./node_modules/vitest/vitest.mjs run",
  "test:watch": "node --env-file=.env.test ./node_modules/vitest/vitest.mjs"
}
```

This ensures Vitest and child workers inherit the test-only environment.
Do not run plain `npx vitest run` for integration tests unless you have explicitly
loaded the same `.env.test` variables.

## 5. Run migrations and tests

From the backend project root, in Windows CMD:

```cmd
node --env-file=.env.test .
ode_modules\prismauild\index.js migrate deploy
npm test
```

If your installed Prisma package exposes a different CLI entry point, use
`npx prisma migrate deploy` from a shell where `.env.test` has been loaded.
Do not use `prisma migrate reset` against any shared or production database.

## 6. Expected safety behavior

The updated environment configuration:
- requires explicit test database and Redis host allowlists;
- rejects test URLs whose hostnames do not match those allowlists;
- rejects test hosts equal to the configured production hosts;
- checks the configured PostgreSQL database name;
- checks the actual connected PostgreSQL database name;
- verifies Redis responds with PONG before seeding test currencies.

The guard is defense-in-depth, not a substitute for verifying the Neon branch
and Redis instance in their provider dashboards. Never share `.env.test` or
connection strings containing credentials.
