# CISNE Enterprise UI adoption coverage

This matrix records code-level adoption. It is not a global acceptance statement. “Fluent controls” means the workspace renders through the single global FluentProvider and its existing React control markup has been migrated to shared Fluent adapters. Data and transaction rules remain in the existing APIs.

| Domain/workspace | Shell + theme | Fluent controls adopted | SAP Fiori pattern | Current proof / remaining scope |
|---|---|---|---|---|
| Customer relationship — clients and NextCRM | Shared | Buttons, text/date inputs, searchable fields, Fluent Dropdowns; Fluent Dialog for client/CRM forms | List + Object Page, related commercial records | Playwright shell/dialog and contextual list checks; real authenticated NextCRM write still requires staging session |
| CRM and sales | Shared | Buttons, text/date inputs, textareas | Existing CRM workspace and opportunity context | Browser validation and business journey with authenticated data remain open |
| Proposals and purchase orders | Shared | Buttons, text/date inputs, textareas; most non-required selects now Fluent Dropdowns | Object Page with lines, relations and history | Commercial API and PostgreSQL tests remain applicable; browser journey remains open |
| Contracts | Shared | Buttons, text/date inputs, textareas; non-required filters use Fluent Dropdowns | Object Page with source proposal, orders and history | Browser journey with real authorized records remains open |
| Service orders and Field Service cockpit | Shared | Buttons, inputs, status/search filters; global worklist actions | Operational workspace, contextual OS opening | Playwright filter/list coverage uses isolated API fixtures; authenticated transaction still open |
| Resource planning and schedule | Shared | Buttons, search fields, Dropdown filters, Fluent DataGrid | Resource worklist with contextual order rail | Playwright tests cover grid, filter, desktop/tablet/mobile screenshots |
| Execution and measurements | Shared | Buttons, inputs, textareas, Fluent Checkbox for evidence selection | Execution/measurement workspaces | E2E with authorized persistent records and MinIO remains open |
| Documents and MinIO | Shared | Buttons, text/date inputs | Document panel/context | MinIO staging browser flow remains open |
| Billing, receivables, payables, treasury, cash flow and bank reconciliation | Shared | Buttons, text/date inputs; eligible non-required selects use Fluent Dropdown | Finance workspaces and payment/settlement context | Monetary integrity tests remain; authenticated receipt-to-settlement browser journey remains open |
| Fiscal manual | Shared | Buttons, inputs, textareas; non-required filters use Fluent Dropdown | Fiscal record/context | No automatic SEFAZ/prefeitura transmission; authenticated persistence test remains open |
| Accounting, ledger and close center | Shared | Buttons, inputs, textareas; non-required filters use Fluent Dropdown | Entry Object Page and ledger views | Accounting/PostgreSQL integration in browser remains open |
| Procurement, inventory and MRP | Shared | Buttons, inputs, textareas; non-required filters use Fluent Dropdown | Purchase/order workspace and receiving context | Transactional selectors marked `required` stay native until required-form parity is tested |
| Assets and professionals | Shared | Buttons, inputs, searchable fields; eligible Dropdown filters | Resource context and history | Browser persistence and scheduling integration remain open |
| Enterprise Command Center | Shared | Buttons and shared status/feedback components | Operations workspace and real API summaries | Operational indicators stay sourced from current APIs; full worklist journey remains open |

## Component migration record

| Previous control/pattern | Adopted control | Actual consumers | Test / status |
|---|---|---|---|
| Native action buttons across module JSX | `EnterpriseButton` backed by Fluent UI `Button` | Shell and all button-bearing workspaces, including relationship, Field, finance, controls, supply and resource modules | Source coverage test asserts no native action button remains in workspace files; Playwright exercises navigation and dialog actions |
| Native text/date/email/url inputs and textareas | `EnterpriseInput` / `EnterpriseTextarea` backed by Fluent UI `Input` / `Textarea` | 22 workspace components plus the root application composition | TypeScript and Playwright form visibility checks |
| Native search fields in common reports | `EnterpriseSearchField` backed by Fluent `Field` + `Input` and Fluent Search icon | Clients, Field Service cockpit, Resource Planning and the other shared search-report consumers migrated from `.search-input` | Playwright verifies accessible search in client list; responsive resource report screenshots |
| Native non-required dropdowns | `EnterpriseDropdown` backed by Fluent `Dropdown` + `Option`; `EnterpriseSelectField` for explicit filters | 39 select controls; native required transactional selects are retained until HTML validation parity is verified | TypeScript, integration and Playwright filter checks |
| Native object navigation tabs | Fluent `TabList` + `Tab` | Client, proposal, contract, payable, accounting and execution Object Pages | Existing section-selection tests plus Playwright navigation |
| Custom resource table | Fluent `DataGrid` | Resource Planning Board | Playwright grid, keyboard, filtering and responsive capture |
| Custom client/CRM modal surfaces | Fluent `Dialog` + `DialogSurface` | Client registration and CRM profile edit | Playwright open, label, Escape close; no test transaction is sent |
| Custom error/loading controls | Fluent `MessageBar` + `Spinner` | Shared error and loading states used across workspaces | Domain contract tests; cross-module browser run pending |
| CISNE-owned Object Page, list report, workspaces, semantic links | React architecture using Fluent controls | Relevant enterprise modules | Documented SAP Fiori interaction patterns; not SAP UI5 components |

## Deliberate library boundaries

Fluent UI React v9 is the shared visual-control library. SAP Fiori structures remain CISNE React compositions using Fluent controls. `@ui5/webcomponents-react` was evaluated for React 19 compatibility, but a second component implementation is not adopted in this migration because no specialized control has yet demonstrated a net functional gain over Fluent without creating duplicate theming, SSR and form behavior. Dynamics 365 is used as an operational workspace reference only; there is no product integration.

The end-to-end browser tests in `test/e2e/enterprise-ui.spec.ts` use isolated intercepted API fixtures for the resource grid. Screenshots are generated by Playwright under `test-results/enterprise`; the tests do not write business records.
