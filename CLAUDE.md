# CLAUDE.md — Quimibond Financial Platform

## Project Overview

Quimibond is a multi-tenant financial management platform for Mexican businesses. It integrates with **Fintoc** (banking/SPEI payments), **Odoo** (ERP), and **SAT/Syntage** (Mexican tax authority) to provide payments, invoicing, collections, treasury, reconciliation, and compliance features.

The UI and error messages are in **Spanish** (es-MX). Code (variables, types, comments) is in **English**.

## Tech Stack

- **Framework**: Next.js 16 (App Router, React 19, RSC enabled)
- **Language**: TypeScript 5.9 (strict mode)
- **Database**: Supabase (PostgreSQL + Auth + RLS)
- **Styling**: Tailwind CSS v4 + shadcn/ui (new-york style)
- **State**: Zustand (client), TanStack React Query (server state)
- **Forms**: React Hook Form + Zod v4 validation
- **Charts**: Recharts
- **Email**: Resend
- **Rate Limiting**: Upstash Redis
- **Testing**: Vitest (node environment)
- **Linting**: ESLint 9 (next/core-web-vitals + next/typescript)
- **Deployment**: Vercel (with cron jobs)

## Commands

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run lint         # ESLint
npm run test         # Vitest (single run)
npm run test:watch   # Vitest (watch mode)
```

## Project Structure

```
src/
├── app/
│   ├── api/                    # Next.js API routes (REST)
│   │   ├── auth/               # Login, register, refresh, switch-company
│   │   ├── payments/           # CRUD + execute, cancel, batch
│   │   ├── invoices/           # Payable/receivable, overdue, CFDI
│   │   ├── vendors/            # Vendor management + CLABE verification
│   │   ├── customers/          # Customer management
│   │   ├── expenses/           # Expense tracking + approval
│   │   ├── budgets/            # Budget management
│   │   ├── approvals/          # Approval rules and workflow
│   │   ├── treasury/           # Balance, cash flow, forecast
│   │   ├── collections/        # Collections and reminders
│   │   ├── sat/                # SAT/Syntage tax services
│   │   ├── reconciliation/     # SAT-Odoo, SAT-App, Bank-App reconciliation
│   │   ├── reports/            # Cash flow, aging, compliance reports
│   │   ├── sync/               # Integration sync triggers
│   │   ├── cron/               # Scheduled jobs (sync-sat, sync-odoo, etc.)
│   │   ├── webhooks/           # Fintoc, Odoo, Syntage webhooks
│   │   ├── dashboard/          # Dashboard summary data
│   │   └── v2/                 # V2 unified sync endpoint
│   ├── (dashboard)/            # Dashboard route group (authenticated pages)
│   │   ├── pagos/              # Payments page
│   │   ├── cobranza/           # Collections page
│   │   ├── facturas/           # Invoices page
│   │   ├── proveedores/        # Vendors page
│   │   ├── clientes/           # Customers page
│   │   ├── gastos/             # Expenses page
│   │   ├── tesoreria/          # Treasury page
│   │   ├── presupuestos/       # Budgets page
│   │   ├── aprobaciones/       # Approvals page
│   │   ├── sat/                # SAT management page
│   │   ├── conciliacion/       # Reconciliation page
│   │   ├── reportes/           # Reports page
│   │   ├── configuracion/      # Settings page (admin only)
│   │   └── onboarding/         # Integration setup wizard
│   ├── login/                  # Login page
│   ├── layout.tsx              # Root layout (Providers wrapper)
│   └── globals.css             # Tailwind + CSS variables
├── components/
│   ├── ui/                     # shadcn/ui primitives (button, card, dialog, etc.)
│   ├── shared/                 # Reusable business components
│   │   ├── data-table.tsx      # Generic data table with sorting/filtering
│   │   ├── filter-bar.tsx      # Search + filter controls
│   │   ├── kpi-card.tsx        # KPI display cards
│   │   ├── status-badge.tsx    # Status indicator badges
│   │   ├── permission-gate.tsx # RBAC-aware conditional rendering
│   │   └── ...
│   ├── layout/                 # Header, sidebar, providers
│   └── dashboard/              # Dashboard-specific components
├── lib/
│   ├── api.ts                  # Client-side API helper (fetch wrapper with auth)
│   ├── store.ts                # Zustand stores (auth, sidebar, sync, UI)
│   ├── rbac.ts                 # Role-based access control (admin/accountant/viewer)
│   ├── db.ts                   # Server-side Supabase query helpers
│   ├── auth-helpers.ts         # Server-side auth extraction from JWT
│   ├── retry.ts                # Retry utility with exponential backoff
│   ├── middleware/              # API middleware stack
│   │   ├── auth.ts             # withAuth — JWT validation + company extraction
│   │   ├── rbac.ts             # withRbac — role permission check
│   │   ├── validate.ts         # withValidation — Zod schema validation
│   │   ├── rate-limit.ts       # Upstash-based rate limiting
│   │   ├── audit.ts            # Audit log writer
│   │   ├── cron-auth.ts        # Cron job authentication
│   │   └── route-handler.ts    # createHandler — error handling + rate limit wrapper
│   ├── supabase/               # Supabase client factories (admin, server)
│   ├── validations/            # Zod schemas (schemas.ts)
│   ├── hooks/                  # React hooks
│   ├── constants/              # App constants
│   ├── integrations/           # Integration client utilities
│   └── utils/                  # Utility functions (response helpers, etc.)
├── packages/                   # Internal domain packages
│   ├── shared/                 # Shared types and error classes
│   ├── auth/                   # Auth package
│   ├── sync-engine/            # Generic sync engine with tests
│   ├── integrations/           # Integration sync implementations
│   │   ├── fintoc/sync.ts      # Fintoc bank sync
│   │   ├── odoo/sync.ts        # Odoo ERP sync
│   │   └── syntage/sync.ts     # Syntage SAT sync
│   └── db/                     # Typed database layer with tests
├── types/
│   └── index.ts                # All shared TypeScript interfaces
└── ...
supabase/
├── migrations/                 # 001–021 sequential SQL migrations
├── seed_reset.sql              # Seed data reset script
└── README.md
```

## Architecture Patterns

### Multi-Tenancy
- Every database table has a `company_id` column
- Supabase RLS policies enforce tenant isolation using `active_company_id` from JWT
- API routes extract `company_id` via `withAuth` middleware from the `user_companies` table
- Client sends `X-Tenant-Id` header and `Authorization: Bearer <token>` on every request

### API Route Pattern
All API routes follow this structure:
```typescript
import { withAuth, AuthContext } from '@/lib/middleware';
import { createHandler } from '@/lib/middleware/route-handler';

export const GET = createHandler(
  withAuth(async (req: Request, ctx: AuthContext) => {
    // ctx.company_id, ctx.user_id, ctx.role, ctx.email available
    // Use getAdminClient() for DB queries (bypasses RLS)
    return Response.json({ data: result });
  }),
  { rateLimit: 'read' }
);
```

### Middleware Stack
API routes compose middleware via higher-order functions:
1. `createHandler` — top-level error handling + optional rate limiting
2. `withAuth` — extracts JWT, validates user, resolves company membership
3. `withRbac` — checks role permissions for the route
4. `withValidation` / `withQueryValidation` — validates request body/query with Zod

### Client-Side API
- `src/lib/api.ts` exports an `api` object with typed methods for every endpoint
- Handles 401 → automatic token refresh → retry; on failure redirects to `/login`
- All API responses follow `{ data: T }` or `{ data: T[], meta: { total, page, limit } }` pattern

### State Management
- **Zustand** stores in `src/lib/store.ts`: `useAuthStore`, `useSidebarStore`, `useSyncStore`, `useUIStore`
- **TanStack Query** for server data fetching/caching in page components
- Auth tokens stored in `localStorage` (token, refresh_token, user, activeCompany, role)

### RBAC
Three roles: `admin`, `accountant`, `viewer`
- Admin has full access (`*`)
- Accountant can read/write most resources, execute payments, run syncs
- Viewer has read-only access to most resources
- Frontend uses `<PermissionGate>` component and `SIDEBAR_VISIBILITY` for UI gating

## Database (Supabase)

- 21 sequential migrations in `supabase/migrations/`
- Key tables: `companies`, `users`, `user_companies`, `integrations`, `vendors`, `customers`, `invoices`, `payments`, `expenses`, `approval_rules`, `approval_requests`, `budgets`, `notifications`, `reconciliations`, `cfdi_documents`
- RLS enabled on all tables; policies use `auth.jwt() ->> 'active_company_id'`
- Admin client (`SUPABASE_SERVICE_ROLE_KEY`) bypasses RLS for server-side operations

## External Integrations

| Integration | Purpose | Config |
|---|---|---|
| **Fintoc** | Banking/SPEI payments, account linking, bank movements | `FINTOC_API_KEY`, `FINTOC_SECRET_KEY`, webhooks |
| **Odoo** | ERP sync (invoices, partners, expenses, purchase orders) | `ODOO_URL/DB/USERNAME/PASSWORD`, per-company override |
| **Syntage** | SAT tax services (CFDI validation, tax returns, compliance) | `SYNTAGE_API_KEY`, webhooks |
| **Resend** | Transactional email (reminders, notifications) | `RESEND_API_KEY` |
| **Upstash** | Rate limiting via Redis | `UPSTASH_REDIS_REST_URL/TOKEN` (implicit) |

## Cron Jobs (Vercel)

Defined in `vercel.json`:
- `sync-sat` — daily at 6:00 UTC
- `sync-odoo` — daily at 3:00 UTC
- `sync-fintoc` — daily at 8:00 UTC
- `check-overdue` — daily at 7:00 UTC
- `check-scheduled` — daily at 9:00 UTC
- `retry-webhooks` — daily at 5:00 UTC

## Conventions

### Code Style
- TypeScript strict mode; unused vars prefixed with `_` (ESLint warning, not error)
- Path alias: `@/*` maps to `./src/*`
- UI components use shadcn/ui (new-york variant) with Radix UI primitives
- Tailwind CSS v4 with CSS variables for theming
- Icons from `lucide-react`

### Naming
- Database columns: `snake_case`
- TypeScript interfaces: `PascalCase`
- API routes follow Next.js App Router conventions: `src/app/api/[resource]/route.ts`
- Dashboard pages: `src/app/(dashboard)/[page-name]/page.tsx`
- Page-specific components: `src/app/(dashboard)/[page-name]/_components/`

### API Responses
- Success: `{ data: T }` or `{ data: T[], meta: { total, page, limit } }`
- Errors: `{ error: { message: string, code?: string } }` with appropriate HTTP status
- Error messages in Spanish for user-facing strings

### Testing
- Test files colocated with source: `*.test.ts`
- Vitest with `globals: true` and `node` environment
- Coverage targets `src/lib/**` and `src/app/api/**`
- Run with `npm test` (single run) or `npm run test:watch`

### Environment Variables
- See `.env.example` for all required variables
- `NEXT_PUBLIC_*` vars are exposed to the client
- Never commit `.env` files (only `.env.example`)
- `SUPABASE_SERVICE_ROLE_KEY` is server-only and must never reach the client

## MCP Configuration

The project includes a Supabase MCP server configured in `.mcp.json` for direct database access during development.

## Common Tasks

### Adding a new API endpoint
1. Create `src/app/api/[resource]/route.ts`
2. Use `createHandler` + `withAuth` pattern
3. Add Zod validation schema in `src/lib/validations/schemas.ts` if needed
4. Add client method in `src/lib/api.ts`
5. Add types in `src/types/index.ts`

### Adding a new dashboard page
1. Create `src/app/(dashboard)/[page-name]/page.tsx`
2. Add page-specific components in `_components/` subdirectory
3. Add route to `SIDEBAR_VISIBILITY` in `src/lib/rbac.ts`
4. Add sidebar link in `src/components/layout/sidebar.tsx`

### Adding a new database migration
1. Create numbered SQL file in `supabase/migrations/` (next sequential number)
2. Include RLS policies with `company_id` filtering
3. Run migration via Supabase CLI or dashboard
