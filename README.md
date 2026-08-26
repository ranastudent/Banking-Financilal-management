# Banking & Financial Management Platform — Phase 1 Planning v3

This package contains the updated planning documents for a production-style multi-currency banking backend.

## Files

```text
architecture.md
database-design.md
api-design.md
transaction-flow.md
provider-integration-design.md
phase-1-questions-and-answers.md
README.md
```

## New Multi-Currency Scope

The platform now supports a multi-currency model.

A customer can have separate balances:

```text
BDT
USD
EUR
INR
...
```

Every monetary record explicitly identifies its currency.

## New FX Rules

### Foreign Currency -> BDT

The customer can convert supported foreign currency to BDT according to the project's configured:

- Exchange rate
- Fees/spread
- Limits
- Risk rules
- Liquidity/reserve rules

### BDT -> Foreign Currency

The customer must submit an approval request containing:

```text
Target currency
Requested amount
Purpose category
Purpose description
Optional supporting reference
```

Authorized ADMIN/AUDITOR workflow reviews the request.

Possible states:

```text
PENDING_APPROVAL
APPROVED
REJECTED
NEEDS_MORE_INFORMATION
EXPIRED
CANCELLED
```

Approval and execution are separate.

## Bank Currency Reserves

The bank maintains a separate reserve for each supported currency.

Initial simulation/demo configuration:

```text
BDT = 500,000
USD = 50,000
EUR = 20,000
INR = 40,000
Other supported currency = 10,000
```

These are project opening values, not real-world banking capital.

The bank cannot fulfill a foreign-currency request beyond the available reserve under the project's defined policy.

Example:

```text
Bank INR = 1,000
Customer requests = 2,000 INR

Result:
Cannot fulfill
```

Reserve checks must be concurrency-safe.

## External Providers

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

The system uses provider adapters so the core banking domain is independent of provider-specific APIs.

## Important Next Step

Before implementing real external providers, verify their current official developer/API documentation, supported operations, currencies, countries, onboarding requirements, authentication, webhooks, settlement rules, and limits.

## Phase 2

After Phase 1 is understood:

1. Initialize Node.js + TypeScript + Express.
2. Create modular project structure.
3. Configure environment variables.
4. Set up PostgreSQL and Redis with Docker.
5. Set up database migrations.
6. Add logging and global error handling.
7. Add request validation.
8. Implement Auth.
9. Implement Users and Accounts.
10. Implement multi-currency balances.
11. Implement transactions and ledger.
12. Implement FX/rate management.
13. Implement currency reserves.
14. Implement FX approval workflow.
15. Implement external provider abstraction.
16. Add providers one at a time.
