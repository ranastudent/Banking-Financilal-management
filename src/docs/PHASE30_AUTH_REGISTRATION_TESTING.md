# Phase 30 — Registration and Login Smoke Test

This guide describes the current authentication flow in this source archive. It does not bypass email verification or enable insecure password recovery.

## Important after `npx prisma migrate reset`

A reset deletes application data in the selected database and reapplies migrations. It does not mean a usable user account has been created. Register a new account before attempting login.

## 1. Confirm the environment

- Confirm `DATABASE_URL` points to the intended Neon **development** database.
- Confirm `REDIS_URL`, both JWT secrets, default-admin settings, and SMTP variables are configured.
- For local Swagger at `http://localhost:5000`, include `http://localhost:5000` in `CORS_ORIGINS`.
- For a frontend running at `http://localhost:5173`, include that origin too.
- Restart the backend after changing `.env`.
- Never commit `.env` or paste credentials, passwords, or tokens into support chats.

The `.env.example` CORS value was updated to include the common local development origins. Copy only the relevant setting into your real `.env`; do not overwrite working credentials.

## 2. Register a new test user

Open `http://localhost:5000/api-docs`, expand Authentication, and execute `POST /api/v1/auth/register`.

Current registration schema:
```json
{
  "name": "Test User",
  "email": "use-a-new-test-address@example.com",
  "phone": "01700000000",
  "password": "Use-a-unique-test-password"
}
```
`phone` is optional. Password must be 8–128 characters. Use a real mailbox you control if SMTP delivery is enabled.

Registration creates the user with `status: INACTIVE` and `emailVerifiedAt: null`, stores a bcrypt password hash, and sends a 6-digit email verification OTP. A registered account is not yet eligible to log in.

## 3. Verify the email

The current route is `POST /api/v1/auth/verify-email`. Check its Swagger request schema and submit the same email plus the OTP received by email. The OTP expires after 10 minutes and has a maximum of five failed attempts. A successful verification sets `emailVerifiedAt` and changes the account status to `ACTIVE`.

If the email does not arrive, check SMTP configuration and backend logs. Do not manually mark a production account verified or expose an OTP in logs. The current route list does not include a resend-OTP endpoint; do not assume one exists.

## 4. Log in

Only after verification succeeds, execute `POST /api/v1/auth/login` with the same email and password used at registration. A successful response should include the user and access/refresh tokens. Never share these tokens.

A `401 Invalid email or password` means the account lookup/password check did not authenticate the request. An unverified account is expected to receive a different 401 message; an inactive account receives 403. Check the account record and verification state without selecting or sharing `passwordHash`.

## 5. Read-only database checks

The Prisma model is mapped to the `public.users` table in the current Neon database. Check a single account without exposing its password hash:
```sql
SELECT id, email, role, status, email_verified_at, created_at,
       password_hash IS NOT NULL AS has_password_hash
FROM public.users
WHERE LOWER(email) = LOWER('use-a-new-test-address@example.com');
```
Column names shown here match the mapped table in the reported database; if the schema changes, inspect `information_schema.columns` first.

## 6. Safety

- Do not run `prisma migrate reset` against production or a database containing important financial data.
- Do not delete users with ad hoc SQL in a banking database; dependent financial records may exist.
- Do not store plaintext passwords, manually replace `password_hash` with plaintext, or disable email verification to make login pass.
- The SSL-mode warning from `pg-connection-string` is separate from registration/login behavior. Review the Neon connection string and SSL mode intentionally rather than changing connection security blindly.

## Verification status

This archive was reviewed statically. It contains the `src/` tree but not the project `package.json`, lockfile, Prisma schema/migrations, or repository-level `docs/openapi.json`; therefore a full build/test run cannot be performed from this archive alone. Run the project's typecheck, build, and focused authentication tests in the complete backend repository after applying the files.
