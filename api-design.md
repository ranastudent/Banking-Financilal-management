# Banking & Financial Management Platform
## API Design Planning Document — v3

**Base URL:** `/api/v1`

## 1. API Principles

- REST
- JSON
- JWT authentication
- RBAC
- Validation
- Pagination
- Request IDs
- Consistent errors
- Idempotency for money-changing requests
- Currency explicitly included in monetary requests

## 2. Authentication

```http
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
```

## 3. User

```http
GET   /api/v1/users/me
PATCH /api/v1/users/me
```

## 4. Account

```http
POST /api/v1/accounts
GET  /api/v1/accounts
GET  /api/v1/accounts/:accountId
GET  /api/v1/accounts/:accountId/balances
```

Example balance response:

```json
{
  "accountId": "acc_1001",
  "balances": [
    { "currency": "BDT", "amount": "100000.00" },
    { "currency": "USD", "amount": "500.00" },
    { "currency": "EUR", "amount": "250.00" }
  ]
}
```

## 5. Deposit

```http
POST /api/v1/accounts/:accountId/deposits
```

Example:

```json
{
  "amount": "5000.00",
  "currency": "USD"
}
```

The backend must validate that USD is supported and must never interpret `5000` as BDT merely because BDT is the default account currency.

## 6. Withdrawal

```http
POST /api/v1/accounts/:accountId/withdrawals
```

Example:

```json
{
  "amount": "3000.00",
  "currency": "EUR"
}
```

The backend checks the customer's EUR balance and all relevant withdrawal rules.

## 7. Internal Transfer

```http
POST /api/v1/transfers
```

Example:

```json
{
  "receiverAccountId": "acc_2002",
  "amount": "5000.00",
  "currency": "BDT"
}
```

For money-changing requests:

```http
Idempotency-Key: unique-request-key
```

## 8. Currency List

```http
GET /api/v1/currencies
```

Returns supported currencies and active status.

## 9. Exchange Rates

```http
GET /api/v1/fx/rates?from=USD&to=BDT
```

Example:

```json
{
  "from": "USD",
  "to": "BDT",
  "rate": "120.00",
  "version": 42,
  "effectiveAt": "..."
}
```

The rate used in a completed transaction must be stored with the transaction/ledger context.

## 10. Foreign Currency -> BDT

```http
POST /api/v1/fx/sell-to-bdt
```

Example:

```json
{
  "sourceCurrency": "USD",
  "sourceAmount": "1000.00"
}
```

Conceptual flow:

```text
USD balance
   ↓
Exchange rate
   ↓
BDT amount
   ↓
Fees/spread
   ↓
BDT balance
```

The backend must validate balance, rate, limits, and applicable reserve/liquidity rules.

## 11. BDT -> Foreign Currency Request

This is not an immediate conversion.

```http
POST /api/v1/fx/foreign-currency-requests
```

Example:

```json
{
  "targetCurrency": "USD",
  "targetAmount": "2000.00",
  "purposeCategory": "EDUCATION",
  "purposeDescription": "Tuition payment for an overseas university.",
  "supportingReference": "optional-reference"
}
```

The request enters an approval workflow.

## 12. View Foreign Currency Requests

```http
GET /api/v1/fx/foreign-currency-requests
GET /api/v1/fx/foreign-currency-requests/:requestId
```

## 13. Admin/Auditor Review

```http
POST /api/v1/admin/fx-requests/:requestId/approve
POST /api/v1/admin/fx-requests/:requestId/reject
POST /api/v1/admin/fx-requests/:requestId/request-information
```

Example:

```json
{
  "reviewNote": "Purpose and supporting information reviewed."
}
```

Authorization must be checked separately for ADMIN and AUDITOR because their permissions may differ.

## 14. Reserve APIs

Admin:

```http
GET /api/v1/admin/currency-reserves
GET /api/v1/admin/currency-reserves/:currency
GET /api/v1/admin/currency-reserves/:currency/movements
```

Example:

```json
{
  "currency": "INR",
  "availableReserve": "1000.00",
  "lockedReserve": "200.00",
  "minimumReserve": "100.00"
}
```

Never expose an unrestricted endpoint that lets a client arbitrarily change reserve amounts.

## 15. MFS / External Provider Deposit

Provider-neutral design:

```http
POST /api/v1/external/deposits
```

Example:

```json
{
  "provider": "BKASH",
  "accountId": "acc_1001",
  "amount": "5000.00",
  "currency": "BDT"
}
```

Supported providers in the project scope:

```text
BKASH
NAGAD
ROCKET
PAYPAL
PAYONEER
WISE
```

Actual supported operations must be capability-checked per provider.

## 16. Bank -> External Provider Transfer

```http
POST /api/v1/external/transfers
```

Example:

```json
{
  "provider": "WISE",
  "sourceAccountId": "acc_1001",
  "amount": "500.00",
  "currency": "USD",
  "recipient": {
    "type": "external",
    "reference": "..."
  }
}
```

The provider adapter handles provider-specific details.

## 17. Provider Webhooks

Conceptually:

```http
POST /api/v1/webhooks/bkash
POST /api/v1/webhooks/nagad
POST /api/v1/webhooks/rocket
POST /api/v1/webhooks/paypal
POST /api/v1/webhooks/payoneer
POST /api/v1/webhooks/wise
```

Requirements:

- Verify provider authenticity.
- Validate provider transaction ID.
- Check idempotency.
- Map provider status to internal status.
- Reconcile safely.
- Audit the result.

## 18. Transactions

```http
GET /api/v1/transactions
GET /api/v1/transactions/:transactionId
```

Filters:

```text
currency
type
status
provider
dateFrom
dateTo
```

## 19. Beneficiaries

```http
POST   /api/v1/beneficiaries
GET    /api/v1/beneficiaries
GET    /api/v1/beneficiaries/:id
PATCH  /api/v1/beneficiaries/:id
DELETE /api/v1/beneficiaries/:id
```

A beneficiary can represent an internal account or supported external recipient.

## 20. Notifications

```http
GET   /api/v1/notifications
PATCH /api/v1/notifications/:id/read
```

## 21. Admin

```http
GET /api/v1/admin/dashboard
GET /api/v1/admin/users
GET /api/v1/admin/accounts
GET /api/v1/admin/transactions
GET /api/v1/admin/audit-logs
GET /api/v1/admin/risk-alerts
```

## 22. Error Codes

```text
UNSUPPORTED_CURRENCY
INVALID_AMOUNT
INSUFFICIENT_BALANCE
INSUFFICIENT_CURRENCY_RESERVE
ACCOUNT_NOT_FOUND
ACCOUNT_BLOCKED
UNAUTHORIZED_ACCOUNT_ACCESS
FX_APPROVAL_REQUIRED
FX_REQUEST_NOT_FOUND
FX_REQUEST_REJECTED
FX_REQUEST_EXPIRED
EXCHANGE_RATE_UNAVAILABLE
EXCHANGE_RATE_CHANGED
IDEMPOTENCY_CONFLICT
TRANSACTION_FAILED
TRANSACTION_PENDING
PROVIDER_ERROR
PROVIDER_TIMEOUT
INVALID_PROVIDER_CALLBACK
```

## 23. Pagination

```http
GET /api/v1/transactions?page=1&limit=20
```

For very large transaction datasets, cursor pagination can be introduced.

## 24. Security

- Never accept client-provided balance updates.
- Never trust client-provided provider success.
- Require authentication for protected routes.
- Enforce resource ownership.
- Enforce role permissions.
- Require idempotency for money-changing operations.
- Validate currency and amount.
- Verify external provider callbacks.
- Avoid secrets in logs.
