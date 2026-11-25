# Accounting integration gates — verified manual invoice links (stage 1)

**Source linkage is not the same as automatic accounting posting.** A journal created manually can now be linked to a specific invoice only after a transaction validates the same authenticated actor's ownership of both, a posted original journal with no reversal, two-sided balanced totals exactly matching the invoice, an open financial period and idempotency. The link is append-only and audited.

| Business path | Automatic posting | Persisted origin link | Guard |
|---|---:|---|---|
| Billing: approved measurement -> invoice | No | Manual invoice -> posted journal, migration 0018 | exact amount/owner, no reversal |
| Receivable generated from invoice | No | Indirect via invoice | settlement and owner gates remain separate |
| Procurement receipts, stock and payable | No | Not implemented | do not claim GL posting |
| Manual fiscal document | No | Not implemented | no external tax submission |
| Standalone accounting journal | Manual, yes | sourceReference alone does not prove linkage | strict balanced lines and closed-period check |

## Architecture

- Additive PostgreSQL table `accounting_invoice_links` stores actor ID, invoice UUID, posted journal UUID, amount, request hash, correlation ID and timestamp. Unique constraints prevent double-linking either side; foreign keys reference both records.
- `POST /api/accounting/invoice-links` works under transaction and locks the financial period before row locks to prevent competing closures/deadlocks. Authorization is enforced by joining invoices to owner-scoped service orders and journals to their posting actor. A replay returns the saved durable receipt; mismatched keys fail.
- A database trigger rejects changes and deletes of the verified link, while a finance audit event records verification. If a journal is subsequently reversed, the link stays as an audit fact but reconciliation treats it as unverified.
- `GET /api/accounting/reconciliation` separately reports manually verified, missing or reversed-linked invoices, with no assumption that human-readable sourceReference is an accounting key.
- The accounting Object Page offers a deliberate user action to associate a posted journal with an invoice. It never posts the journal automatically.
- Existing D1 baseline and legacy owner-scoped business rows are untouched. Global tenancy/RLS and account posting rules remain a later, independently gated stage.

## Outstanding Tier 1 criteria

Automatic posting by configured accounting rule version, recognition vs liquidation, tax posting, payable/stock valuation, fiscal and bank reconciliation, clearing, correction/compensating journals, multi-company close and period reports are **not implemented** by this PR.

A green schema gate, synthetic PostgreSQL integration or Railway SUCCESS is not authenticated E2E/UAT and does not authorize production. Require separate backup restore, cross-module financial reconciliation, full business scenarios, and permission isolation before release.
