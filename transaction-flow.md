# Banking & Financial Management Platform
## Transaction Flow Planning Document — v3

## 1. Core Rule

Every monetary amount must carry a currency.

```text
amount + currency
```

is the minimum conceptual unit.

Never compare:

```text
5,000 USD
```

directly with:

```text
5,000 BDT
```

without conversion.

## 2. Multi-Currency Customer Balance

Example:

```text
Customer Account

BDT = 100,000
USD = 1,000
EUR = 500
INR = 20,000
```

Each currency is independently tracked.

## 3. Deposit Flow

```text
Deposit Request
      |
      v
Authenticate
      |
      v
Authorize account
      |
      v
Validate amount + currency
      |
      v
Check supported currency
      |
      v
BEGIN DATABASE TRANSACTION
      |
      v
Lock account currency balance
      |
      v
Credit requested currency
      |
      v
Create transaction
      |
      v
Create ledger entry
      |
      v
Create audit record
      |
      v
COMMIT
```

Example:

```text
Deposit = 500 USD

Before:
USD = 1,000

After:
USD = 1,500
```

It must not increase BDT.

## 4. External Deposit

For bKash/Nagad/Rocket/PayPal/Payoneer/Wise where the actual provider capability supports the intended flow:

```text
Customer
   |
   v
Choose Provider
   |
   v
Choose Currency
   |
   v
Create Internal Transaction
   |
   v
Provider Adapter
   |
   v
Provider API
   |
   v
Provider Confirmation/Webhook
   |
   v
Verify
   |
   v
Idempotency Check
   |
   v
Credit Correct Currency Balance
   |
   v
Ledger + Audit + Notification
```

The provider must be verified before finalizing the internal financial state.

## 5. Withdrawal

```text
Withdrawal Request
      |
      v
Authenticate
      |
      v
Validate currency
      |
      v
Lock account/currency balance
      |
      v
Check customer balance
      |
      v
Debit requested currency
      |
      v
Ledger
      |
      v
Audit
      |
      v
COMMIT
```

Example:

```text
USD balance = 2,000
Withdraw = 500 USD

Remaining = 1,500 USD
```

## 6. Foreign Currency -> BDT

The customer wants to sell foreign currency and receive BDT.

Example:

```text
Customer:
USD 100

Rate:
1 USD = 120 BDT

Gross:
12,000 BDT
```

Conceptual flow:

```text
Customer USD Balance
        |
        v
Validate USD balance
        |
        v
Get approved exchange rate
        |
        v
Calculate BDT output
        |
        v
Apply configured fee/spread
        |
        v
Lock USD + relevant BDT liquidity
        |
        v
Debit USD
        |
        v
Credit BDT
        |
        v
Create FX transaction
        |
        v
Create two currency ledger legs
        |
        v
Update reserve/settlement records
        |
        v
Audit
        |
        v
COMMIT
```

The exact reserve treatment depends on the project's banking model. The implementation must define whether customer FX sales increase the bank's available foreign-currency reserve and decrease BDT liquidity.

## 7. BDT -> Foreign Currency

This direction requires an approval request.

Example:

```text
Customer wants:
2,000 USD

Purpose:
Education
```

Flow:

```text
Customer
   |
   v
Create FX Request
   |
   v
Validate BDT balance
   |
   v
Validate target currency
   |
   v
Validate target amount
   |
   v
Check preliminary bank reserve
   |
   v
Store purpose/reason
   |
   v
PENDING_APPROVAL
```

Then:

```text
ADMIN / AUDITOR
       |
       v
Review
       |
       +---- REJECT
       |
       +---- NEED MORE INFORMATION
       |
       +---- APPROVE
```

Approval is not the same as execution.

## 8. Why the Purpose/Reason Field Exists

The request contains:

```text
purposeCategory
purposeDescription
supportingReference
```

Example:

```text
Purpose:
EDUCATION

Description:
"Tuition payment for an overseas university."
```

The purpose allows reviewers to understand why the customer is requesting foreign currency.

It also supports:

- Risk assessment
- Internal policy checks
- Auditability
- Approval decisions
- Future compliance workflows

For a real financial institution, actual documentation and regulatory requirements would need to be implemented according to the applicable jurisdiction and provider/bank rules.

## 9. Bank Foreign Currency Reserve

The bank has separate reserves:

```text
BDT = 500,000
USD = 50,000
EUR = 20,000
INR = 40,000
Other supported currency = 10,000
```

These are initial **project simulation values**.

The bank cannot fulfill more foreign currency than the relevant available reserve under the project's reserve policy.

## 10. Reserve Example

Suppose:

```text
Bank INR reserve = 1,000 INR
```

Customer requests:

```text
2,000 INR
```

Then:

```text
2,000 > 1,000
```

Result:

```text
CANNOT FULFILL
```

The request should not be executed merely because the customer has enough BDT.

## 11. Concurrent Reserve Requests

Initial reserve:

```text
INR = 1,000
```

Requests:

```text
Customer A -> 700 INR
Customer B -> 500 INR
```

Correct behavior:

```text
A obtains reserve lock
A receives 700
Remaining = 300

B checks after lock
500 > 300
B is rejected / cannot be fulfilled
```

The reserve check and reserve update must be in a PostgreSQL transaction with appropriate locking.

## 12. FX Approval Execution

After approval:

```text
APPROVED
   |
   v
Re-check:
- approval still valid
- customer balance
- reserve
- currency
- exchange rate
- limits
- account status
   |
   v
BEGIN
   |
   v
Lock BDT balance
   |
   v
Lock target currency reserve
   |
   v
Re-check everything
   |
   v
Calculate final FX amount
   |
   v
Debit BDT
   |
   v
Credit foreign currency
   |
   v
Update reserve
   |
   v
Create transaction
   |
   v
Create ledger entries
   |
   v
Create reserve movement
   |
   v
Create audit
   |
   v
COMMIT
```

The system must never rely only on the earlier approval-time reserve check.

## 13. Transaction State

```text
PENDING
   |
   v
PROCESSING
   |
   +----> COMPLETED
   |
   +----> FAILED
```

Approval workflow has its own state:

```text
PENDING_APPROVAL
       |
       +----> APPROVED
       |
       +----> REJECTED
       |
       +----> NEEDS_MORE_INFORMATION
       |
       +----> EXPIRED
       |
       +----> CANCELLED
```

Do not confuse an **approval state** with a **financial transaction state**.

## 14. Ledger for FX

For:

```text
120,000 BDT -> 1,000 USD
```

The ledger must explicitly record currency:

```text
DEBIT  120,000 BDT
CREDIT 1,000 USD
```

The exact accounting treatment can be expanded later with bank settlement and income/fee accounts.

## 15. Idempotency

For a customer request:

```http
Idempotency-Key: FX-ABC-123
```

If the same request is submitted again:

```text
Do not execute conversion twice.
Return the original result/status.
```

Provider webhooks must also be idempotent.

## 16. Provider Timeout

Never assume timeout means failure.

```text
Provider request
      |
      v
TIMEOUT
      |
      v
PROCESSING / UNKNOWN
      |
      v
Status check or webhook
      |
      +---- SUCCESS
      |
      +---- FAILED
```

This is essential for external payment providers.

## 17. Reconciliation

Background workers can find:

```text
Internal status = PROCESSING
```

and compare it with provider status.

```text
Internal
   |
   v
Provider status check
   |
   v
Compare
   |
   v
Resolve
   |
   v
Audit
```

## 18. Internal Transfer

For same-currency transfer:

```text
Account A
   |
   | 5,000 BDT
   v
Account B
```

Database transaction:

```text
BEGIN
Lock A
Lock B
Check A balance
Debit A
Credit B
Create transaction
Create ledger entries
Create audit
COMMIT
```

## 19. Core Financial Invariants

1. Every monetary amount has a currency.
2. Currency balances are independent.
3. A customer cannot spend more of a currency than they own, subject to explicit overdraft rules.
4. Bank reserve cannot become negative.
5. Foreign-currency fulfillment cannot exceed available reserve under the defined policy.
6. Reserve checks must be concurrency-safe.
7. FX approval and FX execution are separate states.
8. Completed conversions have ledger records.
9. Duplicate requests do not duplicate money movement.
10. Provider callbacks are idempotent.
11. PostgreSQL is the financial source of truth.
12. Redis is not the source of truth for balances/reserves.
