# Banking & Financial Management Platform
## Database Design Planning Document — v3

## 1. Database Goal

PostgreSQL is the authoritative source for customer balances, currency balances, bank reserves, transactions, ledger entries, approvals, provider records, and audit history.

## 2. users

```text
id
name
email
phone
password_hash
role
status
created_at
updated_at
```

Roles:

```text
CUSTOMER
ADMIN
SUPPORT
AUDITOR
```

## 3. accounts

A customer account should not have one ambiguous balance.

```text
accounts
--------
id
user_id
account_number
account_type
status
created_at
updated_at
```

Currency-specific money belongs in a child table.

## 4. account_balances

```text
account_balances
---------------
id
account_id
currency_code
available_balance
locked_balance
created_at
updated_at
```

Important constraint:

```text
UNIQUE(account_id, currency_code)
```

Example:

```text
Account A
  BDT -> 100,000
  USD -> 1,000
  EUR -> 500
  INR -> 20,000
```

This prevents mixing currencies in one balance field.

## 5. currencies

```text
currencies
----------
id
code
name
symbol
decimal_places
is_active
created_at
updated_at
```

Examples:

```text
BDT
USD
EUR
INR
GBP
...
```

Use ISO-style currency codes where appropriate.

## 6. currency_reserves

This represents the bank's available reserve by currency.

```text
currency_reserves
-----------------
id
currency_code
available_reserve
locked_reserve
minimum_reserve
created_at
updated_at
```

Important constraint:

```text
UNIQUE(currency_code)
```

### Project opening reserve configuration

For the initial simulation/demo environment:

```text
BDT = 500,000
USD = 50,000
EUR = 20,000
INR = 40,000
Other supported currency = 10,000
```

The implementation should create separate reserve rows for every actual supported currency rather than a literal "OTHER" row if those currencies are individually supported.

## 7. exchange_rates

```text
exchange_rates
--------------
id
base_currency
quote_currency
rate
buy_rate
sell_rate
spread
source
version
effective_from
effective_to
status
created_at
```

Example:

```text
base = USD
quote = BDT
rate = 120
```

The exact rate model can be simplified initially, then expanded.

Every completed conversion should retain the exact rate/version used.

## 8. transactions

```text
transactions
------------
id
reference
type
status
amount
currency_code
source_account_id
destination_account_id
provider
provider_transaction_id
idempotency_key
failure_code
failure_reason
metadata
created_at
updated_at
```

Possible types:

```text
DEPOSIT
WITHDRAWAL
INTERNAL_TRANSFER
EXTERNAL_DEPOSIT
EXTERNAL_TRANSFER
FX_CONVERSION
REFUND
```

Possible providers:

```text
INTERNAL
BKASH
NAGAD
ROCKET
PAYPAL
PAYONEER
WISE
```

## 9. transaction_legs

For robust multi-currency accounting, a transaction may have multiple monetary legs.

```text
transaction_legs
----------------
id
transaction_id
account_id
currency_code
entry_type
amount
created_at
```

Example BDT -> USD conversion:

```text
Account
  DEBIT  120,000 BDT
  CREDIT 1,000 USD
```

This makes the currency of every movement explicit.

## 10. ledger_entries

```text
ledger_entries
--------------
id
transaction_id
account_id
currency_code
entry_type
amount
balance_before
balance_after
created_at
```

Entry types:

```text
DEBIT
CREDIT
```

For internal same-currency transfer:

```text
Account A
DEBIT  5,000 BDT

Account B
CREDIT 5,000 BDT
```

For FX conversion:

```text
Account
DEBIT  120,000 BDT
CREDIT 1,000 USD
```

## 11. foreign_currency_requests

```text
foreign_currency_requests
-------------------------
id
user_id
account_id
requested_currency
requested_amount
purpose_category
purpose_description
supporting_reference
status
reviewed_by
reviewed_at
review_notes
expires_at
created_at
updated_at
```

Purpose examples:

```text
EDUCATION
MEDICAL
TRAVEL
BUSINESS
INTERNATIONAL_SERVICE
FAMILY_SUPPORT
OTHER
```

The `purpose_description` should explain why the foreign currency is needed.

## 12. approval_records

For a production-style approval history:

```text
approval_records
----------------
id
request_id
reviewer_id
decision
comment
created_at
```

Possible decisions:

```text
APPROVED
REJECTED
NEEDS_MORE_INFORMATION
```

This creates an auditable review history rather than only storing the latest reviewer.

## 13. reserve_movements

Track changes to bank reserves.

```text
reserve_movements
-----------------
id
reserve_id
transaction_id
currency_code
movement_type
amount
balance_before
balance_after
created_at
```

Examples:

```text
CUSTOMER_FX_PURCHASE
CUSTOMER_FX_SELL
EXTERNAL_SETTLEMENT
ADMIN_ADJUSTMENT
OPENING_BALANCE
```

## 14. beneficiaries

```text
beneficiaries
-------------
id
user_id
beneficiary_type
display_name
account_reference
provider
currency_code
status
created_at
updated_at
```

## 15. external_provider_transactions

```text
external_provider_transactions
------------------------------
id
transaction_id
provider
provider_transaction_id
external_reference
currency_code
amount
status
request_payload_hash
response_metadata
created_at
updated_at
```

## 16. notifications

```text
notifications
-------------
id
user_id
type
title
message
channel
status
metadata
created_at
read_at
```

## 17. audit_logs

```text
audit_logs
----------
id
user_id
action
resource_type
resource_id
ip_address
user_agent
metadata
created_at
```

Important events include:

```text
FX_REQUEST_CREATED
FX_REQUEST_APPROVED
FX_REQUEST_REJECTED
FX_CONVERSION_COMPLETED
RESERVE_ADJUSTED
ACCOUNT_BALANCE_CHANGED
EXTERNAL_PAYMENT_CONFIRMED
```

## 18. idempotency_records

```text
idempotency_records
-------------------
id
user_id
idempotency_key
request_hash
response_status
response_body
created_at
expires_at
```

## 19. Opening Bank Reserves

For the demo/simulation environment:

```text
currency | opening reserve
---------|----------------
BDT      | 500,000
USD      | 50,000
EUR      | 20,000
INR      | 40,000
other    | 10,000
```

When implementing actual supported currencies, create one row per currency.

These values represent the project's simulated starting reserve, not real bank assets.

## 20. Important Constraints

- `accounts.account_number` unique.
- `currencies.code` unique.
- `account_balances(account_id, currency_code)` unique.
- `currency_reserves.currency_code` unique.
- Transaction references unique.
- Amounts must be positive where applicable.
- Currency code is required on every monetary record.
- Balances cannot become negative unless explicit overdraft rules exist.
- Reserves cannot become negative.
- Foreign-currency execution cannot exceed available reserve.
- Idempotency keys must be unique within their scope.
- Every completed FX conversion must have corresponding ledger entries.
- Approval records cannot be silently overwritten.

## 21. Indexing Plan

Potential indexes:

```text
users(email)
users(phone)

accounts(user_id)

account_balances(account_id, currency_code)
account_balances(currency_code)

transactions(reference)
transactions(status, created_at)
transactions(source_account_id, created_at)
transactions(destination_account_id, created_at)
transactions(provider, provider_transaction_id)
transactions(currency_code, created_at)

ledger_entries(account_id, currency_code, created_at)

foreign_currency_requests(user_id, created_at)
foreign_currency_requests(status, created_at)
foreign_currency_requests(requested_currency, status)

reserve_movements(currency_code, created_at)

notifications(user_id, created_at)
audit_logs(user_id, created_at)
```

Use query analysis/`EXPLAIN` before adding unnecessary indexes.

## 22. Money Representation

Never use floating-point numbers for financial values.

Use a consistent exact representation such as PostgreSQL `NUMERIC/DECIMAL` or a carefully designed integer minor-unit model.

Currency-specific decimal rules must be respected.

## 23. Transaction Safety

For an FX conversion:

```text
BEGIN

Lock customer currency balances
Lock target bank reserve
Read exchange rate
Validate approval
Validate customer balance
Validate reserve
Debit source currency
Credit target currency
Update bank reserve
Create transaction
Create ledger entries
Create reserve movement
Create audit record

COMMIT
```

If anything required fails:

```text
ROLLBACK
```

## 24. Source of Truth

PostgreSQL is authoritative for:

- Customer balances
- Currency balances
- Bank reserves
- Exchange-rate versions used by transactions
- Transactions
- Ledger
- Approval records
- External provider records
- Audit history

Redis is not authoritative for any of these financial states.
