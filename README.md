# CISNE Rondônia ERP

Enterprise operations platform for service orders, procurement, inventory and finance.

## Structure

- `app/`: React/TypeScript workspaces and routes
- `app/api/`: authenticated business APIs
- `db/`: persistence and migrations
- `lib/`: domain services and integrations
- `components/`: reusable UI primitives

## Quality gates

```bash
pnpm install
pnpm exec tsc --noEmit
pnpm build
```
