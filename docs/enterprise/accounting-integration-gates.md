# Accounting integration gates

This document records the current fail-closed boundary between accounting, billing, receivables, procurement and fiscal paths. A textual source reference is not a persisted accounting relationship.

| Area | Current contract | Accounting link |
|---|---|---|
| Billing | invoice command | Not persisted |
| Receivables | created by invoice command | Not persisted |
| Internal procurement | procurement and receipt commands | Not persisted |
| Fiscal manual | UUID-validated internal origins | Not persisted |
| Accounting | journal command | sourceReference only |

## Rules

- A human-readable sourceReference is not an accounting link.
- Unknown source fields remain rejected by the strict journal schema.
- No UI or API may claim integrated posting until a persisted, transactional relation exists.
- Manual fiscal registration is not authorization and cannot create accounting postings.
- OFBiz and external fiscal transmission remain outside the internal CISNE scope.

A future link must define relation type, source UUID, target journal UUID, tenant ownership, idempotency, correlation, posting status, immutable audit and duplicate/concurrency constraints.

Until then the correct state is NOT_SUPPORTED / BLOCKED_BY_CONTRACT.
