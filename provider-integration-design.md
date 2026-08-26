# External Payment Provider Integration Design
## Updated for Multi-Currency

## 1. Providers

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

## 2. Provider Adapter Pattern

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

The core banking system should not contain provider-specific API calls.

## 3. Provider Capabilities

Each provider may support different capabilities:

```text
DEPOSIT
WITHDRAW
TRANSFER
PAYMENT
REFUND
STATUS_CHECK
WEBHOOK
RECONCILIATION
```

The application should check provider capabilities before attempting an operation.

## 4. Currency Awareness

Every provider operation must specify/derive:

```text
provider
currency
amount
recipient/source
transaction reference
```

The provider's supported currencies must be validated before processing.

Do not assume that because a provider exists in the system it supports every currency or every direction of money flow.

## 5. Example

```text
Customer wants:
500 USD -> external provider
```

The system checks:

```text
Provider supports operation?
Provider supports USD?
Customer has 500 USD?
Any applicable limits?
Any approval requirement?
```

Only then should the provider adapter be called.

## 6. External Transaction Lifecycle

```text
Create internal transaction
        |
        v
Validate currency/provider
        |
        v
Provider adapter
        |
        v
Provider API
        |
        +--> ACCEPTED
        |
        +--> REJECTED
        |
        +--> TIMEOUT/UNKNOWN
        |
        v
Webhook/status check
        |
        v
Verify
        |
        v
Reconcile
        |
        v
Finalize internal state
```

## 7. Timeout Rule

A timeout does not automatically mean failure.

```text
TIMEOUT
   ↓
PROCESSING / UNKNOWN
   ↓
Status Check
   ↓
SUCCESS / FAILED
```

This prevents duplicate external payments.

## 8. Multi-Currency Provider Deposit

For an external deposit:

```text
Provider
   ↓
Provider currency
   ↓
Verified payment
   ↓
Customer matching
   ↓
Credit matching currency balance
```

Example:

```text
Provider sends 500 USD
        ↓
Customer USD balance +500 USD
```

It must not automatically become:

```text
BDT +500
```

unless a deliberate FX conversion occurs.

## 9. Provider Transfer

For:

```text
Bank USD -> Wise
```

the source currency is USD.

For:

```text
Bank BDT -> USD provider transaction
```

the system must explicitly model the FX/conversion step and its rate/approval requirements if the provider flow requires foreign currency.

## 10. Security

- Secure provider credentials.
- Never commit secrets.
- Verify webhooks.
- Never trust client success claims.
- Store provider transaction IDs.
- Use idempotency.
- Avoid sensitive data in logs.
- Implement retry/backoff carefully.
- Reconcile pending/unknown transactions.

## 11. Important Implementation Rule

Before coding a real provider integration, verify its current official API and business requirements.

For each provider determine:

```text
Supported countries
Supported currencies
Supported operations
Authentication
Webhooks
Status APIs
Transaction limits
Settlement
Refund/reversal
Sandbox/test environment
Merchant/business account requirements
```

The project architecture is provider-neutral, but the actual adapter implementation must be provider-specific.
