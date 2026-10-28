# Phase 30 Route Audit

Routes were inventoried from `src/routes/index.ts`, mounted route files, and the root-level operational endpoints in `src/app.ts`. Business API routes use `/api/v1`; `/health` and `/ready` are root-level probes.

- Unique documented path entries: **65**
- Documented operations: **71**

| Method | Path | Tag | Authentication / roles | Request body |
|---|---|---|---|---|
| POST | `/auth/register` | Authentication | Public | RegisterRequest |
| POST | `/auth/login` | Authentication | Public | LoginRequest |
| POST | `/auth/verify-email` | Authentication | Public | VerifyEmailRequest |
| POST | `/auth/refresh` | Authentication | Public | RefreshTokenRequest |
| POST | `/auth/logout` | Authentication | Public | RefreshTokenRequest |
| GET | `/auth/me` | Authentication | authenticated | — |
| GET | `/admin/test` | Admin | ADMIN | — |
| POST | `/accounts` | Accounts | CUSTOMER | CreateAccountRequest |
| GET | `/accounts` | Accounts | CUSTOMER | — |
| GET | `/accounts/{accountId}` | Accounts | CUSTOMER | — |
| PATCH | `/accounts/{accountId}/status` | Accounts | CUSTOMER | UpdateAccountStatusRequest |
| POST | `/accounts/{accountId}/deposits` | Deposits | CUSTOMER, ADMIN | MoneyOperationRequest |
| POST | `/accounts/{accountId}/withdrawals` | Withdrawals | CUSTOMER, ADMIN | MoneyOperationRequest |
| GET | `/transactions` | Transactions | CUSTOMER, ADMIN, SUPPORT, AUDITOR | — |
| POST | `/transactions/deposit/{accountId}` | Deposits | CUSTOMER, ADMIN | MoneyOperationRequest |
| POST | `/transactions/withdrawal/{accountId}` | Withdrawals | CUSTOMER, ADMIN | MoneyOperationRequest |
| POST | `/transactions/transfer/{sourceAccountId}/{destinationAccountId}` | Transfers | CUSTOMER, ADMIN | — |
| GET | `/transactions/{transactionId}` | Transactions | CUSTOMER, ADMIN, SUPPORT, AUDITOR | — |
| POST | `/transfers` | Transfers | CUSTOMER, ADMIN | TransferRequest |
| POST | `/beneficiaries` | Beneficiaries | CUSTOMER | CreateBeneficiaryRequest |
| GET | `/beneficiaries` | Beneficiaries | CUSTOMER | — |
| GET | `/beneficiaries/{beneficiaryId}` | Beneficiaries | CUSTOMER, ADMIN, AUDITOR | — |
| PATCH | `/beneficiaries/{beneficiaryId}` | Beneficiaries | CUSTOMER | UpdateBeneficiaryRequest |
| DELETE | `/beneficiaries/{beneficiaryId}` | Beneficiaries | CUSTOMER | — |
| GET | `/fx-requests/{requestId}` | Transactions | CUSTOMER, ADMIN, SUPPORT, AUDITOR | — |
| GET | `/notifications` | Notifications | authenticated | — |
| PATCH | `/notifications/{id}/read` | Notifications | authenticated | — |
| GET | `/admin/dashboard` | Admin | ADMIN | — |
| GET | `/admin/users` | Admin | ADMIN | — |
| GET | `/admin/users/{userId}` | Admin | ADMIN | — |
| PATCH | `/admin/users/{userId}/status` | Admin | ADMIN | UpdateUserStatusRequest |
| GET | `/admin/accounts` | Admin | ADMIN | — |
| GET | `/admin/accounts/{accountId}` | Admin | ADMIN | — |
| GET | `/admin/transactions` | Admin | ADMIN | — |
| GET | `/admin/transactions/{transactionId}` | Admin | ADMIN | — |
| GET | `/admin/audit-logs` | Admin | ADMIN, AUDITOR | — |
| GET | `/admin/audit-logs/{auditLogId}` | Admin | ADMIN, AUDITOR | — |
| GET | `/admin/currencies` | Admin | ADMIN, AUDITOR, SUPPORT | — |
| GET | `/admin/currencies/{code}` | Admin | ADMIN, AUDITOR, SUPPORT | — |
| PATCH | `/admin/currencies/{code}/status` | Admin | ADMIN | — |
| GET | `/admin/exchange-rates` | Admin | CUSTOMER, ADMIN, SUPPORT, AUDITOR | — |
| GET | `/admin/exchange-rates/{exchangeRateId}` | Admin | CUSTOMER, ADMIN, SUPPORT, AUDITOR | — |
| POST | `/admin/exchange-rates` | Admin | ADMIN | GenericObjectRequest |
| GET | `/admin/currency-reserves` | Admin | ADMIN, AUDITOR | — |
| GET | `/admin/currency-reserves/{currencyCode}` | Admin | ADMIN, AUDITOR | — |
| POST | `/admin/currency-reserves/{currencyCode}/adjust` | Admin | ADMIN | GenericObjectRequest |
| GET | `/admin/approvals/fx-requests` | Admin | ADMIN, AUDITOR, SUPPORT | — |
| GET | `/admin/approvals/fx-requests/{requestId}` | Admin | ADMIN, AUDITOR, SUPPORT | — |
| POST | `/admin/approvals/fx-requests/{requestId}/decision` | Admin | ADMIN | GenericObjectRequest |
| GET | `/support/customers` | Support | SUPPORT | — |
| GET | `/support/customers/accounts/{accountId}` | Support | SUPPORT | — |
| GET | `/support/customers/{customerId}/transactions` | Support | SUPPORT | — |
| POST | `/support/customers/{customerId}/support-operations` | Support | SUPPORT | GenericObjectRequest |
| GET | `/support/customers/{customerId}/beneficiaries/{beneficiaryId}` | Support | SUPPORT | — |
| GET | `/support/audit-logs` | Support | SUPPORT | — |
| GET | `/support/audit-logs/{auditLogId}` | Support | SUPPORT | — |
| GET | `/auditor/audit-logs` | Auditor | AUDITOR | — |
| GET | `/auditor/audit-logs/{auditLogId}` | Auditor | AUDITOR | — |
| GET | `/auditor/transactions` | Auditor | AUDITOR | — |
| GET | `/auditor/transactions/{transactionId}` | Auditor | AUDITOR | — |
| GET | `/auditor/accounts/{accountId}/activity` | Auditor | AUDITOR | — |
| GET | `/auditor/approvals` | Auditor | AUDITOR | — |
| GET | `/auditor/approvals/{approvalRecordId}` | Auditor | AUDITOR | — |
| GET | `/auditor/approval-records` | Auditor | AUDITOR | — |
| GET | `/auditor/approval-records/{approvalRecordId}` | Auditor | AUDITOR | — |
| GET | `/auditor/fx-requests` | Auditor | AUDITOR | — |
| GET | `/auditor/fx-requests/{requestId}` | Auditor | AUDITOR | — |
| GET | `/users/me` | Users | authenticated | — |
| PATCH | `/users/me` | Users | authenticated | UpdateMyProfileRequest |

## Source gaps detected

- Duplicate `POST /api/v1/accounts/{accountId}/deposits` declaration exists in `src/account/routes/account.routes.ts`.
- The supplied ZIP includes no package manifest or TypeScript config, so Swagger dependency and build integration cannot be verified from this archive alone.
- Several routes do not attach a Zod schema at the route declaration. Their exact payload contract needs controller/schema verification; these are explicitly flagged in OpenAPI descriptions.
- Response schemas for complex domain endpoints are generic success envelopes until controller-specific response payloads are fully reconciled.
