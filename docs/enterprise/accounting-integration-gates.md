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

## Evidence

The current journal contract accepts id, effectiveDate, sourceReference, description and balanced lines. The journal_entries table contains source_reference, but no source_type, source_id, invoice ID, receivable ID, procurement order ID, fiscal document ID, or polymorphic relation table.

The invoice and receivable tables are linked to each other, and fiscal documents can validate UUID origins. Neither contract creates or posts a journal entry. Procurement creates purchase orders and receipts but has no accounting command.

## Fail-closed rules

1. A journal with a human-readable sourceReference is not an accounting link.
2. Unknown source fields must remain rejected by the strict accounting request schema.
3. No UI or API may report billing, receivable, procurement, or fiscal accounting integration until a persisted relation and transactionally recorded posting contract exists.
4. Manual fiscal registration remains manual and non-authorized; it cannot create an accounting posting.
5. OFBiz and external fiscal transmission remain out of scope until their real configuration/contracts exist.

## Required contract before implementation

A future accounting-link change must first introduce and test an explicit contract containing, at minimum: relation type, source UUID, target journal UUID, actor/tenant ownership, idempotency key, correlation ID, posting status and failure state, immutable audit event, and duplicate/concurrency constraints.

Until that contract exists, the correct state is NOT_SUPPORTED / BLOCKED_BY_CONTRACT, not a simulated success.
