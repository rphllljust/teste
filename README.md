# CISNE Rondônia ERP

Enterprise operations platform for service orders, procurement, inventory and finance.

## Architecture

- `app/`: React/TypeScript application routes and workspaces
- `app/api/`: authenticated business APIs
- `db/`: persistence and migrations
- `lib/`: domain services, integrations and validation
- `components/`: reusable UI primitives

## Quality gates

```bash
pnpm install
pnpm exec tsc --noEmit
pnpm build
```

The repository is organized around business processes rather than generic CRUD screens.