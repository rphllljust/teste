# OpenFieldPro reference integration

- Source repository: https://github.com/niko4244/openfieldpro
- Branch inspected: ofp-monorepo
- Reference commit: 25ba62297ba4b6890656017dd425117de166b94a
- License: AGPL-3.0-only (LICENSE, copyright Nikolas Marconcini)

## Scope decision

No OpenFieldPro source files or AGPL-covered implementation were copied into CISNE. The repository was inspected as a functional reference for field-service concepts: operational queues, dispatch-oriented filtering, work-order lifecycle visibility, technician execution context, and closeout traceability.

The CISNE implementation in this branch is an independent adaptation using the existing React/TypeScript components, CISNE API contracts, authorization and persistence. This avoids introducing AGPL obligations into the CISNE source while retaining provenance for the evaluated reference.

## First increment

app/ServiceOperationsWorkspace.tsx now exposes effective server-backed views, categories and sorting for service orders. The UI sends the existing view, category and sort query contracts to app/api/orders/route.ts, preserving owner isolation and existing domain state transitions.
