# Test Coverage Analysis

**Date:** 2026-03-17
**Current state:** 22 test files, 279 passing tests

## Summary

The codebase has **~126 API route files** across all endpoints, but only **13 API test files** covering a fraction of them. Core library utilities have decent coverage (4/~20 modules tested), and the internal packages are well-covered (5 test files for the sync engine, DB layer, and all 3 integration syncs). However, significant gaps exist in critical business logic, middleware, and validation layers.

---

## Current Coverage Map

### What IS tested

| Area | Test File | Tests |
|------|-----------|-------|
| **Lib: auth-helpers** | `src/lib/auth-helpers.test.ts` | 13 |
| **Lib: db** | `src/lib/db.test.ts` | 7 |
| **Lib: rbac** | `src/lib/rbac.test.ts` | 19 |
| **Lib: retry** | `src/lib/retry.test.ts` | 7 |
| **API: cron jobs** | `src/app/api/cron/cron.test.ts` | ~20 |
| **API: expenses** | `src/app/api/expenses/expenses.test.ts` | 7 |
| **API: fintoc** | `src/app/api/fintoc/route.test.ts` | ~15 |
| **API: fintoc/exchange** | `src/app/api/fintoc/exchange/route.test.ts` | 6 |
| **API: onboarding** | `src/app/api/onboarding/route.test.ts` | ~10 |
| **API: reconciliation** | `src/app/api/reconciliation/reconciliation.test.ts` | ~15 |
| **API: sat/syntage** | `src/app/api/sat/syntage/route.test.ts` | ~10 |
| **API: sat/upload** | `src/app/api/sat/upload/route.test.ts` | 8 |
| **API: sync-logs** | `src/app/api/sync-logs/route.test.ts` | 9 |
| **API: v2/sync** | `src/app/api/v2/sync/route.test.ts` | ~15 |
| **API: webhooks** | `src/app/api/webhooks/webhooks.test.ts` | ~20 |
| **API: e2e flow** | `src/app/api/__tests__/e2e-flow.test.ts` | ~25 |
| **API: payments-approvals** | `src/app/api/__tests__/payments-approvals.test.ts` | ~20 |
| **Pkg: sync-engine** | `src/packages/sync-engine/__tests__/sync-engine.test.ts` | ~15 |
| **Pkg: typed-db** | `src/packages/db/__tests__/typed-db.test.ts` | 3 |
| **Pkg: fintoc-sync** | `src/packages/integrations/__tests__/fintoc-sync.test.ts` | 3 |
| **Pkg: odoo-sync** | `src/packages/integrations/__tests__/odoo-sync.test.ts` | 3 |
| **Pkg: syntage-sync** | `src/packages/integrations/__tests__/syntage-sync.test.ts` | 9 |

### What is NOT tested

Below are the gaps, organized by priority.

---

## Priority 1 — Critical Business Logic (High Impact)

### 1. Middleware Stack (0% coverage)
**Files:** `src/lib/middleware/auth.ts`, `rbac.ts`, `validate.ts`, `rate-limit.ts`, `audit.ts`, `route-handler.ts`, `cron-auth.ts`
**Lines:** ~336 total
**Why critical:** Every API route depends on this middleware. Bugs here affect the entire application — authentication bypass, authorization failures, validation skips, or rate-limit misconfiguration.

**Recommended tests:**
- `auth.ts`: Valid JWT extraction, expired token handling, missing company membership, multi-tenant isolation
- `rbac.ts`: Permission checks for all 3 roles (admin, accountant, viewer), denied access scenarios
- `validate.ts`: Valid/invalid request body validation, query parameter validation, error message formatting
- `route-handler.ts`: Error wrapping, rate-limit integration, unexpected error handling
- `cron-auth.ts`: Valid/invalid cron secrets, missing authorization header

### 2. Auth Routes (0% coverage)
**Files:** 7 routes under `src/app/api/auth/` (login, register, logout, refresh, reset-password, switch-company, me)
**Why critical:** Authentication is the front door. Bugs here can cause security vulnerabilities or lock users out.

**Recommended tests:**
- Login: valid credentials, invalid password, non-existent user, rate limiting
- Register: successful creation, duplicate email, weak password validation
- Refresh: valid refresh token, expired token, revoked token
- Switch-company: valid company switch, unauthorized company access
- Reset-password: token generation, token validation, password update

### 3. Payments Routes (0% coverage for individual routes)
**Files:** 8 routes under `src/app/api/payments/` (CRUD, execute, cancel, retry, batch, scheduled, poll-status)
**Why critical:** This is a financial platform — payment execution, cancellation, and batch processing are core money-moving operations.

**Recommended tests:**
- Execute: successful SPEI payment, insufficient balance, approval required, Fintoc API error handling
- Cancel: valid cancellation, already-processed payment, unauthorized cancellation
- Batch: partial success handling, rollback behavior
- Scheduled: list filtering, execution timing
- Poll-status: status transitions, timeout handling

### 4. Invoices Routes (0% coverage)
**Files:** 7 routes under `src/app/api/invoices/` (CRUD, payable, receivable, overdue)
**Why critical:** Invoicing is a core financial feature. Incorrect overdue calculations or payable/receivable filtering directly impacts financial reporting.

**Recommended tests:**
- CRUD: create with CFDI data, update status, pagination/filtering
- Payable/receivable: correct filtering by type, summary calculations
- Overdue: date-based filtering accuracy, edge cases around due dates

---

## Priority 2 — Important Business Features (Medium-High Impact)

### 5. Validation Schemas (0% coverage)
**File:** `src/lib/validations/schemas.ts` (284 lines)
**Why important:** Zod schemas define the contract for all API inputs. Invalid schemas silently accept bad data or reject valid data.

**Recommended tests:**
- Test each schema with valid data, missing required fields, wrong types, edge cases (empty strings, negative amounts, invalid RFCs, invalid CLABE numbers)

### 6. Collections Routes (0% coverage)
**Files:** 7 routes under `src/app/api/collections/` (aging, overdue, pending, send-reminder, payment-links, summary)
**Why important:** Collections is a key revenue feature. Send-reminder triggers external emails.

**Recommended tests:**
- Aging report: correct bucket calculations (30/60/90 days)
- Send-reminder: email dispatch, rate limiting, idempotency
- Payment links: generation, expiration

### 7. Treasury Routes (0% coverage)
**Files:** 5 routes under `src/app/api/treasury/` (balance, accounts, movements, forecast, snapshot)
**Why important:** Treasury provides the financial dashboard. Incorrect balance or forecast calculations mislead business decisions.

**Recommended tests:**
- Balance: multi-account aggregation, currency handling
- Forecast: projection accuracy, edge cases
- Movements: filtering, pagination

### 8. Vendors and Customers Routes (0% coverage)
**Files:** 5 vendor routes + 5 customer routes
**Why important:** CLABE verification (`verify-clabe`) interacts with Fintoc and validates Mexican bank account numbers. Customer CLABE creation also involves external calls.

**Recommended tests:**
- CLABE verification: valid/invalid CLABEs, Fintoc API error handling
- CRUD: pagination, search, filtering by company
- Related data: vendor bills, customer invoices

---

## Priority 3 — Supporting Features (Medium Impact)

### 9. Reports Routes (0% coverage)
**Files:** 6 routes under `src/app/api/reports/` (cash-flow, aging, budget-vs-actual, compliance, vendor/customer summary)
**Why:** Reports aggregate data — incorrect calculations cascade to business decisions.

### 10. SAT Routes (partially covered — 2 of 14 routes)
**Files:** 12 untested routes under `src/app/api/sat/` (validate, validate-bulk, validate-rfc, cancel, check-efos, invoices, extractions, tax-returns, tax-status, tax-retentions, tax-compliance, extract)
**Why:** SAT/tax compliance is legally required for Mexican businesses. CFDI validation errors can cause regulatory issues.

### 11. Approvals Routes (partially covered via e2e tests, but no unit tests)
**Files:** 7 routes under `src/app/api/approvals/`
**Why:** Approval workflows gate financial operations. Edge cases (concurrent approvals, threshold changes) need isolated testing.

### 12. Utility Functions (0% coverage)
**Files:** `src/lib/utils/format.ts` (70 lines), `crypto.ts` (63 lines), `validation.ts` (123 lines), `response.ts`, `errors.ts`
**Why:** Pure functions are the easiest to test and format/validation bugs propagate everywhere.

### 13. Budgets Routes (0% coverage)
**Files:** 3 routes (CRUD + budget-vs-actual)
**Why:** Budget tracking with actual-vs-planned comparisons involves complex aggregation.

---

## Priority 4 — Infrastructure & Remaining (Lower Impact)

### 14. Notification Routes (0% coverage)
**Files:** 3 routes (list, mark-read, unread-count)

### 15. User Management Routes (0% coverage)
**Files:** 4 routes (list, invite, deactivate, role change)

### 16. Dashboard Route (0% coverage)
**File:** `src/app/api/dashboard/route.ts`

### 17. Search, Setup, Health Routes (0% coverage)
**Files:** 3 routes

### 18. Integration Clients (0% coverage)
**Files:** `src/lib/integrations/fintoc.ts`, `odoo.ts`, `syntage.ts`
**Why:** These wrap external API calls. Mocked tests ensure correct request formatting and error handling.

---

## Recommendations

### Quick Wins (High value, low effort)
1. **Utility functions** (`format.ts`, `crypto.ts`, `validation.ts`) — pure functions, no mocking needed
2. **Validation schemas** (`schemas.ts`) — table-driven tests with valid/invalid inputs
3. **Middleware unit tests** (`auth.ts`, `validate.ts`, `route-handler.ts`) — mock Supabase, test in isolation

### Highest-Impact Additions
4. **Auth routes** — security-critical, test all flows
5. **Payments routes** — money-moving operations, test happy path + error cases
6. **Invoices routes** — core financial data, test CRUD + filtering

### Structural Improvements
7. **Add coverage thresholds** to `vitest.config.ts` to prevent regression:
   ```typescript
   coverage: {
     thresholds: {
       statements: 50,
       branches: 40,
       functions: 50,
       lines: 50,
     }
   }
   ```
8. **Install `@vitest/coverage-v8`** as a dev dependency — currently missing, so `npm test -- --coverage` fails
9. **Separate unit vs integration tests** — the current e2e-flow test is valuable but slow. Consider splitting fast unit tests from integration tests with different configs.

### Coverage Target
- Current estimated coverage: **~15-20%** of `src/lib/` and `src/app/api/` (by file count)
- Recommended short-term target: **50%** statement coverage
- Recommended long-term target: **70%** statement coverage
