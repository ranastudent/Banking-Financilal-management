# Phase 30 — API Documentation (OpenAPI / Swagger)

## Included
- `docs/openapi.json`: OpenAPI 3.0.3 contract with endpoint inventory, bearer authentication, request schemas for routes with explicit Zod schemas, common response/error envelopes, validation notes, and role requirements.
- `src/docs/swagger.ts`: Swagger UI loader.
- `src/app.ts`: mounts Swagger UI at `/api-docs` and raw OpenAPI JSON at `/api-docs.json` in non-production environments only.

## Install dependencies in the backend project
The supplied ZIP contained source files only, not `package.json`/lockfile. From the backend project root run:

```bash
npm install swagger-ui-express
npm install -D @types/swagger-ui-express
```

`swagger-ui-express` is the only new runtime dependency; OpenAPI is stored as JSON so no YAML parser is needed.

## Run and open docs
Start the backend as usual in a non-production environment, then open:
- Swagger UI: `http://localhost:<PORT>/api-docs`
- OpenAPI JSON: `http://localhost:<PORT>/api-docs.json`

The API server uses `/api/v1` as its route prefix; the OpenAPI `servers` entry reflects this. Protected endpoints use the `bearerAuth` security scheme. Use the Authorize button with an access token.

## Accuracy notes / follow-up required
1. The source ZIP does not include the backend `package.json`, lockfile, `tsconfig.json`, or runtime `.env`, so dependency installation and typecheck must be run in the real project.
2. Routes without route-level Zod body schemas are marked as provisional in the OpenAPI contract (`GenericObjectRequest` or route-specific notes). Confirm exact controller request/response contracts before treating those as final.
3. The supplied `src/account/routes/account.routes.ts` declares `POST /:accountId/deposits` twice. The OpenAPI spec documents the unique HTTP endpoint once; the duplicate route declaration should be reviewed separately.
4. The current global error handler establishes the common error envelope and status codes documented here; rate-limiter middleware may have its own exact response shape.
5. Swagger UI is intentionally disabled when `NODE_ENV=production`; keep production API docs private or publish them through an explicitly approved deployment configuration.

## Validation checklist
- [ ] Install dependencies in the full backend project.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Start the app in development and load `/api-docs`.
- [ ] Check every endpoint against controller response shapes and all validation schemas.
- [ ] Exercise representative success, 400, 401, 403, 404, 409, 429, and 500 responses.
- [ ] Ensure no secrets, real customer data, or production tokens are included in examples.
