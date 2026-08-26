# Banking & Financial Management Platform
## Architecture Planning Document — v3

**Version:** 3.0  
**Purpose:** Production-style backend planning

## 1. System Goal

Build a secure, transaction-safe banking and financial management backend. The platform supports:

- Multi-currency customer balances
- Internal deposits, withdrawals, and transfers
- Currency conversion
- Local providers: bKash, Nagad, Rocket
- International providers: PayPal, Payoneer, Wise
- Foreign-currency conversion approval workflow
- Bank foreign-currency reserve management
- Transaction ledger
- Audit logging
- Risk/fraud controls
- Notifications
- Admin and auditor approval workflows

This is not a simple CRUD banking application. The project should demonstrate financial consistency, authorization, concurrency control, idempotency, auditability, reconciliation, and multi-currency accounting.

## 2. Important Financial Concept

A user's balance is **currency-specific**.

Do not model one generic balance like:

```text
balance = 100000
```

Instead:

```text
User
 ├── BDT balance
 ├── USD balance
 ├── EUR balance
 ├── INR balance
 └── other supported currency balances
```

A user may therefore have:

```text
BDT  = 100,000
USD  = 500
EUR  = 250
INR  = 10,000
```

The system must never silently treat these amounts as if they were the same currency.

## 3. User Roles

### CUSTOMER

Can:

- Register/login
- Manage profile
- View own currency balances
- Deposit supported currencies
- Withdraw supported currencies where permitted
- Transfer supported currencies
- Manage beneficiaries
- View transaction history
- Request currency conversion
- Submit a foreign-currency purchase/use-case reason
- Receive notifications

A customer can convert:

```text
Foreign Currency -> BDT
```

according to the system's supported rules.

A customer requesting:

```text
BDT -> Foreign Currency
```

must submit a foreign-currency request with a proper purpose/reason.

The request is reviewed by authorized ADMIN/AUDITOR workflow according to business policy.

### ADMIN

Can:

- Manage users
- Manage accounts
- Manage supported currencies
- Manage exchange-rate configuration
- Monitor transactions
- Manage bank currency reserves
- Review foreign-currency requests
- Approve/reject requests where authorized
- Review risk/fraud alerts
- View audit logs
- Manage account status

### SUPPORT

Can help customers with account and transaction information but should not directly approve foreign-currency requests or modify reserves unless explicitly granted a separate permission.

### AUDITOR

Primarily reviews:

- Transactions
- Ledger
- Currency conversions
- Foreign-currency requests
- Reserve movements
- Audit logs
- Risk/fraud events

Auditor approval should be controlled by explicit permissions and separation-of-duties rules.

## 4. Major Modules

```text
Auth
Users
Accounts
Currencies
Transactions
Ledger
FX / Currency Conversion
Foreign Currency Requests
Bank Currency Reserves
Beneficiaries
External Payment Providers
Notifications
Audit
Admin
Risk/Fraud
```

## 5. Multi-Currency Architecture

The system has three related concepts:

### Customer currency balance

How much of a particular currency the customer owns.

### Bank currency reserve

How much of a particular currency the bank currently has available for supported customer operations.

### Exchange rate

How much one currency is worth relative to another at a specific rate/version/time.

Example:

```text
Customer:
USD  = 1,000
BDT  = 100,000

Bank reserve:
USD  = 50,000
BDT  = 500,000
```

These are separate financial states.

## 6. Bank Currency Reserve

The bank maintains currency-specific reserves.

Example initial simulation configuration:

```text
BDT = 500,000
USD = 50,000
EUR = 20,000
INR = 40,000
Other supported currency = 10,000
```

These are **project/demo opening reserves**, not a claim about real banking capital.

Each currency should have its own reserve record.

Example:

```text
currency_reserves
-----------------
BDT -> 500,000
USD -> 50,000
EUR -> 20,000
INR -> 40,000
...
```

The bank must not approve a foreign-currency delivery/withdrawal that exceeds the available reserve, subject to the project's defined reserve policy.

Example:

```text
Bank INR reserve = 1,000

Customer requests = 2,000 INR

2,000 > 1,000
        ↓
Reject / cannot fulfill
```

The reserve check must happen atomically with the relevant financial operation so two simultaneous requests cannot both spend the same reserve.

## 7. Currency Conversion

### Foreign Currency -> BDT

The platform may allow a customer to convert supported foreign currency to BDT, subject to:

- Customer balance
- Supported currency
- Exchange rate
- Fees/spread
- Limits
- Compliance/risk rules
- Bank reserve/liquidity rules

Example:

```text
Customer:
USD 100

Exchange rate:
1 USD = 120 BDT

Gross:
100 × 120 = 12,000 BDT

Then apply configured fee/spread if applicable.
```

### BDT -> Foreign Currency

This direction requires an additional approval workflow.

The customer submits:

```text
Requested currency: USD
Amount: 2,000
Purpose/reason: ...
Supporting information: ...
```

The system creates:

```text
PENDING_FX_APPROVAL
```

Authorized ADMIN/AUDITOR workflow reviews the request.

Possible result:

```text
APPROVED
REJECTED
NEEDS_MORE_INFORMATION
EXPIRED
CANCELLED
```

Approval does not itself mean money has moved. The actual conversion should occur only after all required checks pass.

## 8. Why Require a Foreign-Currency Purpose?

The project introduces a `purpose/reason` field to model a controlled foreign-currency purchase process.

Examples:

```text
Education
Medical treatment
Travel
Import/business payment
International service payment
Family support
Other legitimate purpose
```

The user should provide a clear explanation.

The reason helps authorized reviewers understand:

- Why the customer needs the currency
- What currency is requested
- How much is requested
- Whether the request is consistent with policy
- Whether additional supporting information is needed

This field is part of the project's compliance/risk workflow. The exact legal requirements for a real financial institution would need to be determined separately.

## 9. Approval Workflow

```text
Customer
   |
   v
BDT -> Foreign Currency Request
   |
   v
Validate request
   |
   v
Check balance
   |
   v
Check requested currency
   |
   v
Check bank reserve
   |
   v
Create approval request
   |
   v
ADMIN / AUDITOR Review
   |
   +---- REJECTED
   |
   +---- NEEDS_MORE_INFORMATION
   |
   +---- APPROVED
              |
              v
       Re-check all conditions
              |
              v
       Execute conversion
              |
              v
       Update balances
              |
              v
       Update reserves
              |
              v
       Ledger + Audit
              |
              v
       Notification
```

The system must re-check balance, reserve, exchange rate, limits, and approval validity immediately before execution.

## 10. Important Reserve Rule

Suppose:

```text
Bank INR reserve = 1,000 INR
```

Customer A requests:

```text
700 INR
```

Customer B requests:

```text
500 INR
```

If A is fulfilled first:

```text
Reserve:
1,000 - 700 = 300 INR
```

B cannot then receive 500 INR.

The reserve check must be protected with database locking/transactional logic.

## 11. External Payment Provider Architecture

Supported providers:

### Local

```text
bKash
Nagad
Rocket
```

### International

```text
PayPal
Payoneer
Wise
```

Use provider adapters:

```text
PaymentProvider
   |
   +-- BkashAdapter
   +-- NagadAdapter
   +-- RocketAdapter
   +-- PaypalAdapter
   +-- PayoneerAdapter
   +-- WiseAdapter
```

The core banking domain should not contain provider-specific API details.

## 12. High-Level Architecture

```text
Client
  |
  v
API Gateway / HTTP Layer
  |
  +--> Rate Limiting
  +--> Request ID
  +--> Logging
  |
  v
Authentication + Authorization
  |
  v
Banking Application
  |
  +--> Users
  +--> Accounts
  +--> Currencies
  +--> Transactions
  +--> Ledger
  +--> FX / Conversion
  +--> FX Approval
  +--> Currency Reserves
  +--> Beneficiaries
  +--> External Providers
  +--> Notifications
  +--> Audit
  +--> Admin
  +--> Risk/Fraud
  |
  +-------------------+
  |                   |
  v                   v
PostgreSQL            Redis
  |                   |
  |                   +--> Cache
  |                   +--> Rate limiting
  |                   +--> Idempotency support
  |                   +--> Job queue support
  |
  v
Transaction Ledger

Background Workers
  |
  +--> Notifications
  +--> Provider status checks
  +--> Reconciliation
  +--> FX/risk jobs
  +--> Reports
```

## 13. Core Architectural Principles

- PostgreSQL is the financial source of truth.
- Redis is not the source of truth for balances or reserves.
- Money-changing operations are transactional.
- Duplicate requests must be idempotent.
- Currency is part of every monetary amount.
- No generic client endpoint can directly set a balance.
- Currency conversions must create financial records.
- Foreign-currency approval is separate from execution.
- Reserve availability must be checked before foreign-currency fulfillment.
- Reserve updates must be concurrency-safe.
- Provider callbacks must be verified and idempotent.
- Sensitive actions must be audited.

## 14. Scalability Direction

Start as a modular monolith:

```text
One backend
 |
 +-- Auth
 +-- Users
 +-- Accounts
 +-- Currency
 +-- Transactions
 +-- Ledger
 +-- FX
 +-- Reserves
 +-- External Providers
 +-- Notifications
 +-- Admin
 +-- Risk/Fraud
```

Services can be separated later if justified by scale.
