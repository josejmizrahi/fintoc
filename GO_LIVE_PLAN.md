# Quimibond — Go-Live Plan

**Date**: March 17, 2026
**Status**: Pre-Production

---

## Current State Assessment

### What's Done
- **Build**: Clean production build, zero lint errors, 279 tests passing
- **API Layer**: 50+ API routes fully implemented (auth, payments, invoices, vendors, customers, expenses, budgets, approvals, treasury, collections, reconciliation, SAT/Syntage, Fintoc, reports, search, sync, cron, webhooks)
- **Frontend**: 13 dashboard pages (pagos, cobranza, facturas, proveedores, clientes, gastos, tesoreria, presupuestos, aprobaciones, sat, conciliacion, reportes, configuracion) + login + onboarding
- **Database**: 21 migrations covering full schema with RLS policies
- **Integrations**: Fintoc (banking/SPEI), Odoo (ERP), Syntage (SAT) — clients, sync engines, and webhooks
- **Auth & RBAC**: JWT-based multi-tenant auth with 3 roles (admin/accountant/viewer)
- **Middleware**: Auth, RBAC, validation, rate limiting, audit logging, cron auth
- **CI**: GitHub Actions pipeline (lint + type check + test)
- **Cron Jobs**: 6 scheduled jobs configured in vercel.json
- **Testing**: 22 test files with unit + integration + e2e flow tests
- **Code Quality**: Zero TODOs/FIXMEs in codebase, TypeScript strict mode

---

## Go-Live Phases

### Phase 1: Environment & Infrastructure Setup (Week 1)

#### 1.1 Supabase Production Project
- [ ] Create production Supabase project (separate from dev/staging)
- [ ] Run all 21 migrations in order on production database
- [ ] Verify RLS policies are active on all tables
- [ ] Generate and securely store service role key
- [ ] Configure auth settings (JWT expiry, email templates in Spanish)
- [ ] Set up database backups (Supabase Pro plan — daily point-in-time recovery)

#### 1.2 Vercel Production Deployment
- [ ] Create Vercel project linked to the `main` branch
- [ ] Configure all environment variables from `.env.example`:
  - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
  - `NEXT_PUBLIC_APP_URL` (production domain)
  - `ENCRYPTION_KEY` (generate 64-char hex: `openssl rand -hex 32`)
  - `FINTOC_API_KEY` / `FINTOC_SECRET_KEY` / `FINTOC_WEBHOOK_SECRET` / `FINTOC_JWS_PRIVATE_KEY`
  - `SYNTAGE_API_KEY` / `SYNTAGE_WEBHOOK_SECRET`
  - `ODOO_URL` / `ODOO_DB` / `ODOO_USERNAME` / `ODOO_PASSWORD`
  - `RESEND_API_KEY`
  - `CRON_SECRET` (generate: `openssl rand -hex 32`)
- [ ] Configure custom domain + SSL
- [ ] Enable Vercel Cron Jobs (Pro plan required for all 6 crons)
- [ ] Set up Vercel environment separation (Preview vs Production)

#### 1.3 Third-Party Accounts (Production)
- [ ] **Fintoc**: Obtain production API keys, configure webhook endpoint (`/api/webhooks/fintoc`), set up JWS key pair
- [ ] **Syntage**: Obtain production API key, configure webhook endpoint (`/api/webhooks/syntage`)
- [ ] **Odoo**: Confirm production instance access and credentials
- [ ] **Resend**: Verify sending domain, configure production API key
- [ ] **Upstash**: Create production Redis instance for rate limiting (if using Upstash — check if env vars needed)

---

### Phase 2: Security Hardening (Week 1-2)

#### 2.1 Authentication & Authorization
- [ ] Verify JWT token expiry is set appropriately (e.g., 1h access, 7d refresh)
- [ ] Confirm refresh token rotation is enabled in Supabase
- [ ] Test multi-tenant isolation: ensure Company A cannot access Company B data
- [ ] Test all 3 roles (admin/accountant/viewer) against every API endpoint
- [ ] Verify `SUPABASE_SERVICE_ROLE_KEY` is never exposed to client-side code

#### 2.2 API Security
- [ ] Verify rate limiting is active on all public endpoints
- [ ] Confirm webhook signature verification for Fintoc and Syntage
- [ ] Confirm `CRON_SECRET` is validated on all cron routes
- [ ] Audit `ENCRYPTION_KEY` usage for integration credential storage
- [ ] Test CORS settings — ensure only production domain is allowed
- [ ] Review CSP headers in `next.config.ts`

#### 2.3 Data Security
- [ ] Verify RLS policies on all tables with production-like data
- [ ] Test that admin client is only used server-side
- [ ] Confirm no `.env` or secrets in the git repository
- [ ] Set up Vercel environment variable encryption

---

### Phase 3: Integration Testing (Week 2)

#### 3.1 Fintoc (Banking)
- [ ] Test account linking flow end-to-end (widget → webhook → stored)
- [ ] Test SPEI payment execution (sandbox first, then production with small amount)
- [ ] Test batch payment execution
- [ ] Verify bank movement sync via cron (`sync-fintoc`)
- [ ] Test webhook reception and processing
- [ ] Test exchange rate API endpoint

#### 3.2 Odoo (ERP)
- [ ] Test partner sync (vendors + customers)
- [ ] Test invoice sync (payable + receivable)
- [ ] Test expense sync
- [ ] Verify cron sync (`sync-odoo`)
- [ ] Test webhook reception

#### 3.3 Syntage/SAT
- [ ] Test SAT certificate upload (`.cer` + `.key`)
- [ ] Test CFDI validation (single + bulk)
- [ ] Test RFC validation
- [ ] Test tax compliance/status check
- [ ] Test EFOS check
- [ ] Verify cron sync (`sync-sat`)
- [ ] Test Syntage webhook processing

#### 3.4 Cross-System
- [ ] Test SAT-Odoo reconciliation flow
- [ ] Test SAT-App reconciliation flow
- [ ] Test Bank-App reconciliation flow
- [ ] Verify reconciliation reports

---

### Phase 4: Functional Testing (Week 2-3)

#### 4.1 Core Workflows
- [ ] **Onboarding**: New company setup → integration configuration → first sync
- [ ] **Payments**: Create → approve → execute → verify in bank → reconcile
- [ ] **Invoices**: Sync from Odoo/SAT → categorize → mark paid → reconcile
- [ ] **Collections**: Generate collection reminders → track payment status
- [ ] **Expenses**: Create → approval workflow → categorize → report
- [ ] **Budgets**: Create budget → track actuals → alert on overspend
- [ ] **Approvals**: Configure rules → trigger approval → approve/reject flow

#### 4.2 Dashboard & Reports
- [ ] Verify dashboard KPIs load correctly
- [ ] Test cash flow report generation
- [ ] Test aging report (receivables + payables)
- [ ] Test SAT compliance report
- [ ] Test vendor/customer summary reports
- [ ] Verify search functionality across entities

#### 4.3 Multi-Tenant
- [ ] Test company switching flow
- [ ] Verify data isolation between companies
- [ ] Test user invitation flow
- [ ] Test role assignment and permission gates

---

### Phase 5: Performance & Monitoring (Week 3)

#### 5.1 Performance
- [ ] Run Lighthouse audit on key pages (target: 90+ Performance)
- [ ] Test API response times under load (especially sync and report endpoints)
- [ ] Verify cron jobs complete within Vercel timeout limits (default 10s, max 300s Pro)
- [ ] Optimize any slow database queries (check Supabase query performance)
- [ ] Verify TanStack Query caching reduces redundant API calls

#### 5.2 Monitoring & Alerting
- [ ] Set up Vercel Analytics (Web Vitals)
- [ ] Set up error tracking (Sentry or Vercel Error Tracking)
- [ ] Configure Supabase database alerts (storage, connections, latency)
- [ ] Set up uptime monitoring for production URL
- [ ] Configure email alerts for cron job failures
- [ ] Set up Fintoc/Syntage webhook failure alerts

#### 5.3 Logging
- [ ] Verify audit log captures all financial operations
- [ ] Ensure sync logs are queryable via `/api/sync-logs`
- [ ] Set up log retention policy

---

### Phase 6: Pre-Launch Checklist (Week 3-4)

#### 6.1 Data & Configuration
- [ ] Seed initial company data (or prepare onboarding for first customer)
- [ ] Configure default approval rules
- [ ] Set up email templates in Resend (collection reminders, notifications)
- [ ] Verify all UI strings are in Spanish (es-MX)
- [ ] Test all error messages display in Spanish

#### 6.2 Documentation
- [ ] Create user guide for onboarding flow
- [ ] Document API for any external consumers
- [ ] Create runbook for common operational tasks (manual sync, data fixes)
- [ ] Document incident response process

#### 6.3 Legal & Compliance
- [ ] Privacy policy and terms of service
- [ ] SAT compliance requirements verified
- [ ] Data processing agreements with Fintoc, Syntage, Odoo
- [ ] Ensure CFDI handling meets SAT requirements

#### 6.4 Backup & Recovery
- [ ] Test database restore from Supabase backup
- [ ] Document rollback procedure for bad deployments (Vercel instant rollback)
- [ ] Test integration credential re-encryption procedure

---

### Phase 7: Staged Rollout (Week 4)

#### 7.1 Soft Launch (Internal / Pilot)
- [ ] Deploy to production with 1-2 pilot companies
- [ ] Monitor for 3-5 business days
- [ ] Verify all cron jobs execute successfully
- [ ] Verify webhook delivery and processing
- [ ] Check sync data accuracy against Odoo/SAT/bank statements
- [ ] Collect pilot user feedback

#### 7.2 Fix & Stabilize
- [ ] Address any bugs found during pilot
- [ ] Tune rate limits based on actual usage
- [ ] Optimize any slow queries identified in monitoring
- [ ] Update error messages based on user feedback

#### 7.3 General Availability
- [ ] Open onboarding for all target customers
- [ ] Enable customer self-service onboarding
- [ ] Monitor error rates and latency for first week
- [ ] Scale Supabase plan if needed (connections, storage)

---

## Estimated Timeline

| Phase | Duration | Dependencies |
|---|---|---|
| 1. Environment Setup | 3-5 days | Fintoc/Syntage/Odoo production credentials |
| 2. Security Hardening | 3-5 days | Phase 1 complete |
| 3. Integration Testing | 5-7 days | Production credentials + Phase 2 |
| 4. Functional Testing | 5-7 days | Can overlap with Phase 3 |
| 5. Performance & Monitoring | 3-5 days | Phase 3-4 complete |
| 6. Pre-Launch Checklist | 3-5 days | Phase 5 complete |
| 7. Staged Rollout | 5-10 days | All phases complete |

**Total estimated: 4-6 weeks to production**

---

## Critical Path Items

These items will determine timeline more than anything else:

1. **Production API credentials** from Fintoc, Syntage, and Odoo — start procurement NOW
2. **Supabase Pro plan** — needed for daily backups and higher connection limits
3. **Vercel Pro plan** — needed for cron jobs and longer function execution times
4. **First pilot company** — identify and prepare 1-2 customers for soft launch
5. **SAT compliance sign-off** — verify CFDI handling meets regulatory requirements

---

## Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Fintoc production approval delay | High — blocks payment execution | Start application process immediately; test everything else with sandbox |
| SAT regulation changes | Medium — may require schema/flow changes | Monitor SAT bulletins; build with flexibility |
| Supabase connection limits | Medium — could cause outages under load | Monitor connections; implement connection pooling if needed |
| Webhook delivery failures | Medium — missed data updates | Retry mechanism in place (`retry-webhooks` cron); add dead letter queue monitoring |
| Multi-tenant data leak | Critical — compliance/legal issue | Comprehensive RLS testing; penetration test before launch |
| Encryption key rotation | Low — operational complexity | Document procedure; implement key rotation before scaling |

---

## Post-Launch Roadmap

Once stable in production:
- [ ] Add automated E2E tests (Playwright) for critical flows
- [ ] Implement real-time notifications (Supabase Realtime or WebSocket)
- [ ] Add export functionality (Excel/PDF for reports)
- [ ] Mobile-responsive optimization
- [ ] Multi-currency support (USD alongside MXN)
- [ ] Advanced analytics dashboard
- [ ] API rate limit tiers per company plan
