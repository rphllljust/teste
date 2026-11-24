# Accounting integration gates

## Audit scope

This document records the contracts verified on the accounting, billing, receivables, procurement and fiscal paths. It is intentionally fail-closed: a textual sourceReference is not treated as a persisted document relationship.

## Verified contracts

| Area | Existing contract | Accounting link currently persisted | Gate |
|---|---|---:|---|
| Billing | POST /api/commands with command=invoice | No | Do not claim accounting posting |
| Receivables | Created transactionally by the invoice command | No | Do not claim accounting posting |
| Internal procurement | /api/procurement and procurement command/receipt routes | No | Do not claim accounting posting |
| Fiscal manual | /api/fiscal/documents with UUID-validated origins | No | Do not claim accounting posting |
| Accounting | POST /api/accounting/journals | sourceReference only | Standalone journal only |

## Fail-closed rules

A journal sourceReference is not an accounting link. No UI or API may report integrated posting until a persisted relation and transactionally recorded posting contract exists. Manual fiscal registration remains non-authorized and cannot create a posting. OFBiz and external fiscal transmission remain blocked until their real configuration exists.

## Required future contract

A future change must introduce an explicit relation type, source UUID, journal UUID, tenant ownership, idempotency key, correlation ID, posting status, immutable audit event, and duplicate/concurrency constraints. Until then the state is NOT_SUPPORTED / BLOCKED_BY_CONTRACT.
