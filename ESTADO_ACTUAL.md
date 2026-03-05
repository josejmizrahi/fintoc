# Estado Actual Completo del Proyecto — Payana

## 1. Arquitectura General

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Next.js 16)                     │
│  React 19 · Tailwind 4 · Shadcn/UI · Zustand · Recharts         │
├─────────────┬──────────────┬──────────────┬─────────────────────┤
│   Login     │  Onboarding  │  Dashboard   │  15 páginas más     │
│   (público) │  (wizard)    │  (KPIs)      │  (protegidas)       │
└──────┬──────┴──────┬───────┴──────┬───────┴─────────┬───────────┘
       │             │              │                 │
       ▼             ▼              ▼                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                    API ROUTES (Next.js App Router)                │
│  /api/auth/*  ·  /api/onboarding  ·  /api/[[...path]] (catch-all)│
│  /api/sat/upload  ·  /api/sync-logs  ·  /api/webhooks/fintoc     │
├──────────────────────────────────────────────────────────────────┤
│                    MIDDLEWARE (auth check en cada request)        │
└──────┬──────────────┬──────────────┬─────────────────────────────┘
       │              │              │
       ▼              ▼              ▼
┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────────────┐
│   Odoo     │ │   Fintoc   │ │    SAT     │ │   Supabase         │
│  JSON-RPC  │ │  REST API  │ │   SOAP     │ │  PostgreSQL + Auth │
│  (ERP)     │ │  (Banking) │ │  (Fiscal)  │ │  (17 tablas + RLS) │
└────────────┘ └────────────┘ └────────────┘ └────────────────────┘
```

---

## 2. Stack Tecnológico

| Capa | Tecnología | Versión |
|------|-----------|---------|
| Framework | Next.js (App Router) | 16.1.6 |
| UI | React | 19.2.3 |
| Estilos | Tailwind CSS | 4 |
| Componentes | Shadcn/UI + Radix UI | 1.4.3 |
| Estado | Zustand | 5.0.11 |
| Charts | Recharts | 3.7.0 |
| Forms | React Hook Form + Zod | 7.71 / 4.3 |
| DB | Supabase (PostgreSQL) | 2.98.0 |
| Auth | Supabase Auth + JWT custom | |
| Testing | Vitest | 4.0.18 |
| Notificaciones | Sonner (toasts) | 2.0.7 |

---

## 3. Estructura de Archivos

### Librerías Core (`src/lib/`)

| Archivo | Líneas | Función | Exports principales |
|---------|--------|---------|-------------------|
| `api.ts` | 230 | Cliente API centralizado | `api` (objeto con todos los endpoints) |
| `store.ts` | 82 | Estado global (Zustand) | `useAuthStore`, `useSidebarStore` |
| `db.ts` | 159 | Queries a Supabase (server-side) | `hasDB`, `query`, `insert`, `update`, `seedDB` |
| `auth-helpers.ts` | 52 | Utilidades de auth para API routes | `getCompanyId`, `maskConfig`, `resolveConfig` |
| `auth-server.ts` | 367 | Lógica de autenticación completa | `verifyToken`, `registerUser`, `loginUser` |
| `fintoc.ts` | 55 | Cliente REST para Fintoc API | `fintocGet`, `fintocPost` |
| `odoo.ts` | 99 | Cliente JSON-RPC para Odoo | `odooJsonRpc`, `odooAuthenticate`, `odooSearchRead`, `odooFetchAll` |
| `sat.ts` | 120 | Validación CFDI contra SAT SOAP | `validateCfdiAgainstSat`, `parseCfdiXml`, `testSatReachability` |
| `supabase.ts` | 8 | Cliente Supabase browser-side | `supabase` |
| `env.ts` | 27 | Validación de env vars | `getEnv`, `hasEnv` |
| `utils.ts` | 6 | Helpers | `cn` (clsx + tailwind-merge) |

### Componentes (`src/components/`)

| Archivo | Función |
|---------|---------|
| `fintoc-widget.tsx` | Botón que abre widget Fintoc SDK para conectar datos fiscales |
| `sync-status.tsx` | Indicador de progreso de sincronización con polling cada 2s |
| `layout/sidebar.tsx` | Sidebar de navegación colapsable (15 rutas) |
| `layout/header.tsx` | Header con theme toggle, notificaciones, menú usuario |
| `layout/providers.tsx` | Wrapper de ThemeProvider + Toaster |
| `ui/*.tsx` | 21 componentes Shadcn/UI (button, card, dialog, table, tabs, etc.) |

### Páginas (`src/app/`)

| Ruta | Archivo | Función |
|------|---------|---------|
| `/login` | `login/page.tsx` | Login + Registro + Demo rápido |
| `/` | `(dashboard)/page.tsx` | Dashboard con 8 KPIs, pagos recientes, facturas vencidas |
| `/onboarding` | `onboarding/page.tsx` | Wizard 3 pasos: Odoo → Fintoc → SAT |
| `/pagos` | `pagos/page.tsx` | Crear/ejecutar/programar pagos SPEI |
| `/cobranza` | `cobranza/page.tsx` | Facturas pendientes, vencidas, aging, links de pago |
| `/facturas` | `facturas/page.tsx` | Cuentas por cobrar y pagar con detalle CFDI |
| `/proveedores` | `proveedores/page.tsx` | Gestión de proveedores, CLABEs, facturas |
| `/clientes` | `clientes/page.tsx` | Gestión de clientes, CLABEs, facturas |
| `/gastos` | `gastos/page.tsx` | Gastos de empleados con workflow de aprobación |
| `/tesoreria` | `tesoreria/page.tsx` | Posición de caja, forecast, movimientos |
| `/presupuestos` | `presupuestos/page.tsx` | Presupuestos vs real |
| `/aprobaciones` | `aprobaciones/page.tsx` | Reglas de aprobación y solicitudes pendientes |
| `/sat` | `sat/page.tsx` | Subir XML, validar CFDI individual/masivo |
| `/conciliacion` | `conciliacion/page.tsx` | Conciliación Fintoc-Odoo y SAT |
| `/reportes` | `reportes/page.tsx` | Cash flow, aging, compliance SAT, vendor summary |
| `/configuracion` | `configuracion/page.tsx` | Config de Odoo, Fintoc, SAT, General |

### API Routes (`src/app/api/`)

| Ruta | Método | Auth | Función |
|------|--------|:---:|---------|
| `/api/auth/register` | POST | ❌ | Registro (crea user + company + seed) |
| `/api/auth/login` | POST | ❌ | Login (Supabase Auth + JWT) |
| `/api/auth/me` | GET | ✅ | Perfil del usuario actual |
| `/api/health` | GET | ❌ | Health check |
| `/api/onboarding` | GET/POST | ✅ | Status, save, test, sync, complete |
| `/api/sat/upload` | POST | ✅ | Upload .cer/.key como base64 |
| `/api/sync-logs` | GET | ✅ | Historial de sincronizaciones |
| `/api/webhooks/fintoc` | POST | ❌ | Webhook receiver para eventos Fintoc |
| `/api/[[...path]]` | ALL | ✅ | **Catch-all (1125 líneas)** — todos los endpoints de negocio |

**Endpoints del catch-all (principales):**
- `payments/*` — CRUD + execute + poll-status + schedule
- `collections/*` — pending, overdue, aging, CLABEs, payment-links
- `invoices/*` — receivable, payable, overdue, CFDI detail
- `vendors/*` — CRUD, CLABE, verify-clabe, bills
- `customers/*` — CRUD, CLABE, invoices
- `expenses/*` — CRUD, summary, action (approve/reject/pay)
- `approvals/*` — rules, pending, approve, reject
- `treasury/*` — snapshot, forecast, cash-flow, balance, movements
- `budgets/*` — CRUD, vs-actual, spend
- `reconciliation/*` — fintoc-odoo, sat, history
- `sat/*` — validate, validate/bulk, upload-xml, documents, revalidate-all
- `reports/*` — cash-flow, aging, sat-compliance, budget-vs-actual
- `notifications/*` — list, unread-count, mark-read
- `fintoc/exchange` — token exchange para widget fiscal
- `companies/*` — list, create

### Tests (`src/**/*.test.ts`)

| Archivo | Tests | Cobertura |
|---------|:-----:|-----------|
| `lib/sat.test.ts` | 26 | escapeXml, parseCfdiXml, validateCfdi, reachability |
| `lib/odoo.test.ts` | 15 | jsonRpc, authenticate, searchRead, fetchAll pagination |
| `lib/auth-helpers.test.ts` | 13 | maskConfig, resolveConfig |
| `lib/db.test.ts` | 7 | hasDB, query/insert/update sin DB |
| `api/sat/upload/route.test.ts` | 8 | auth, file validation, upload flow |
| `api/onboarding/route.test.ts` | 19 | GET status, save/test/sync todos los providers |
| `api/sync-logs/route.test.ts` | 9 | provider filtering, pagination |
| **Total** | **97** | |

---

## 4. Base de Datos — 17 Tablas en Supabase

### Tablas principales con mapeo de sincronización

#### `payments` (20 columnas)
| Columna | Tipo | Odoo | Fintoc | Manual |
|---------|------|:---:|:---:|:---:|
| company_id | FK→companies | ✅ | ✅ | ✅ |
| direction | TEXT | ✅ | ✅ | ✅ |
| status | TEXT | ✅ ("confirmed") | ✅ ("confirmed") | ✅ |
| amount | NUMERIC(15,2) | ✅ | ✅ | ✅ |
| currency | TEXT | ✅ | ✅ | ✅ |
| partner_name | TEXT | ✅ | ✅ | ✅ |
| partner_rfc | TEXT | ❌ **NUNCA** | ❌ **NUNCA** | ✅ |
| reference_id | TEXT | ✅ | ✅ | ✅ |
| clabe_origin | TEXT | ❌ NUNCA | ❌ NUNCA | ❌ NUNCA |
| clabe_destination | TEXT | ❌ | ❌ | ✅ |
| fintoc_transfer_id | TEXT | ❌ | ✅ | ❌ |
| fintoc_payment_intent_id | TEXT | ❌ | ❌ | ✅ (ejecutar) |
| executed_at | TIMESTAMPTZ | ✅ | ✅ | ✅ |
| sat_status | TEXT | ❌ NUNCA | ❌ NUNCA | ❌ NUNCA |
| payment_state | TEXT | ❌ NUNCA | ❌ NUNCA | ❌ NUNCA |

#### `invoices` (16 columnas)
| Columna | Tipo | Odoo | Fintoc | SAT |
|---------|------|:---:|:---:|:---:|
| company_id | FK→companies | ✅ | ✅ | |
| name | TEXT | ✅ | ✅ | |
| type | TEXT | ✅ | ✅ | |
| partner_name | TEXT | ✅ | ✅ | |
| partner_rfc | TEXT | ❌ **NUNCA** | ❌ **NUNCA** | |
| amount_total | NUMERIC(15,2) | ✅ | ✅ (÷100) | |
| amount_residual | NUMERIC(15,2) | ✅ | ✅ (=total) | |
| date_invoice | DATE | ✅ | ✅ | |
| date_due | DATE | ✅ | ❌ NUNCA | |
| status | TEXT | ✅ | ✅ ("open") | |
| cfdi_uuid | TEXT | ✅ | ✅ (institution_id!) | |
| sat_status | TEXT | ❌ | ❌ | ✅ (update only) |
| source | TEXT | ❌ NUNCA | ✅ ("fintoc_fiscal") | |
| payment_state | TEXT | ❌ NUNCA | ❌ NUNCA | |

#### `vendors` / `customers` (7 columnas c/u)
| Columna | Odoo | Manual |
|---------|:---:|:---:|
| name | ✅ | ✅ |
| rfc | ✅ (vat) | ✅ |
| email | ✅ | ✅ |
| clabe | ❌ NUNCA | ✅ |

#### `cfdi_documents` (13 columnas)
| Columna | Upload XML | Revalidación |
|---------|:---:|:---:|
| uuid | ✅ | |
| rfc_emisor | ✅ | |
| rfc_receptor | ✅ | |
| total | ✅ | |
| tipo_comprobante | ❌ NUNCA | |
| nombre_emisor | ❌ NUNCA | |
| nombre_receptor | ❌ NUNCA | |
| sat_status | | ✅ |
| xml_content | ✅ | |

#### `bank_movements` (10 columnas)
**⚠️ TABLA COMPLETAMENTE VACÍA — nunca se usa. Fintoc movements van directo a `payments`.**

### Tablas operativas (sin issues de sync)
- `companies` — nombre, rfc, onboarding_completed
- `users` — auth_uid, email, role, company_id
- `integrations` — provider, config (JSONB), cert info, sync status
- `sync_logs` — provider, status, progress, timestamps
- `expenses` — employee, category, amount, status, cfdi_uuid
- `approval_rules` — min/max amount, approvers, auto-approve
- `approval_requests` — payment_id, rule_id, status, approver
- `budgets` — period, budgeted vs spent vs committed
- `notifications` — type, title, message, is_read
- `reconciliations` — type, status, matched/unmatched counts
- `reconciliation_entries` — payment_ref, amounts, difference, status

---

## 5. Flujos de Sincronización

### Odoo Sync (4 fases)
```
1. res.partner [customer_rank > 0]  →  customers (name, rfc, email)
   - Dedup: por rfc, luego por name
   - Solo INSERT (no update)

2. res.partner [supplier_rank > 0]  →  vendors (name, rfc, email)
   - Dedup: por rfc, luego por name
   - Solo INSERT (no update)

3. account.move [out_invoice, in_invoice]  →  invoices
   - Campos: name, type, partner_name, amounts, dates, status, cfdi_uuid
   - Dedup: por cfdi_uuid, luego por name
   - INSERT o UPDATE (amounts, status, cfdi_uuid)

4. account.payment [posted, sent, reconciled]  →  payments
   - Campos: direction, amount, currency, reference_id, partner_name, executed_at
   - Dedup: por reference_id
   - Solo INSERT (no update)
```

### Fintoc Sync (2 fases)
```
1. /accounts/{id}/movements (últimos 30 días)  →  payments
   - Campos: direction, amount, currency, reference_id, partner_name, fintoc_transfer_id
   - Dedup: por fintoc_transfer_id
   - Solo INSERT

2. /invoices (requiere link_token)  →  invoices
   - Campos: type, partner_name, amount (÷100), date_invoice, cfdi_uuid (=institution_id)
   - Dedup: por cfdi_uuid
   - Solo INSERT
```

### SAT Sync (revalidación)
```
invoices WHERE cfdi_uuid IS NOT NULL  →  UPDATE invoices.sat_status
- Llama SAT SOAP service por cada factura
- Resultado: Vigente / Cancelado / No encontrado
```

---

## 6. Flujos de Usuario Principales

### Registro → Onboarding
```
/login (registro) → Crea user + company + seed demo data
    → Redirect a /onboarding
        → Paso 1: Conectar Odoo (URL, DB, user, password) → Test → Sync
        → Paso 2: Conectar Fintoc (Secret key, Public key) → Test → Sync
        → Paso 3: Conectar SAT (RFC, .cer/.key upload, PAC) → Test → Sync
    → Completar onboarding
    → Redirect a / (dashboard)
```

### Ejecución de Pago SPEI
```
/pagos → Crear pago (vendor, monto, CLABE)
    → Status: draft → pending_approval
    → /aprobaciones → Aprobar (si monto > regla)
    → Status: approved
    → Ejecutar → POST /payments/:id/execute
    → Fintoc API: POST /payment_intents
    → Status: processing
    → Poll cada 15s → GET /payment_intents/:id
    → Status: confirmed | failed
```

### Validación CFDI
```
/sat → Subir XML
    → Parsear UUID, RFC emisor/receptor, total
    → POST SAT SOAP → obtener status
    → Guardar en cfdi_documents
    → Mostrar resultado (Vigente/Cancelado)

/sat → Validar individual (UUID + RFCs + total)
    → POST SAT SOAP → resultado inmediato

/sat → Validar masivo (lista de UUIDs)
    → Validar uno por uno, actualizar invoices.sat_status
```

### Conciliación
```
/conciliacion → Seleccionar periodo (7/14/30 días)
    → Fintoc vs Odoo: Comparar payments por reference_id/amount
    → SAT: Validar cfdi_uuid de facturas contra SAT
    → Resultados: matched / unmatched / partial
    → Guardar en reconciliations + reconciliation_entries
```

---

## 7. Seguridad

- **Auth**: Supabase Auth + JWT custom. Middleware valida Bearer token en cada request.
- **RLS**: Row Level Security habilitado en las 17 tablas. `auth_company_id()` function para tenant isolation.
- **Config masking**: Passwords y API keys se envían como "••••••••" al frontend.
- **CLABE validation**: Regex 18 dígitos (sin validación de dígito verificador).
- **Roles**: admin, manager, accountant, viewer (definidos pero sin enforcement en API routes).

---

## 8. Problemas Encontrados

### CRÍTICOS (afectan funcionalidad core)
1. **`bank_movements` tabla vacía** — Fintoc movements van a `payments`, no se guardan como movimientos bancarios raw.
2. **`partner_rfc` nunca se sincroniza** en payments ni invoices — no se puede hacer match automático por RFC entre tablas.
3. **No hay `odoo_id`** en ninguna tabla — no se puede hacer sync bidireccional ni actualizar registros existentes de Odoo.
4. **Fintoc `cfdi_uuid` es `institution_id`** — NO es un UUID real del SAT, no sirve para validación.
5. **`source` solo se llena para Fintoc** — facturas de Odoo quedan sin origen, imposible distinguir.
6. **SAT sync usa `rfcEmisor` como emisor Y receptor** — incorrecto para facturas recibidas (debería usar el RFC del partner).

### IMPORTANTES (afectan completitud)
7. **Odoo no importa CLABE** de partners — campo banco disponible en Odoo pero no se fetchea.
8. **No se sincronizan gastos de Odoo** — tabla `expenses` es solo manual.
9. **`sat_validated` en expenses** nunca se actualiza automáticamente al ingresar cfdi_uuid.
10. **cfdi_documents no se ligan a invoices** — subir un XML no busca/crea la factura correspondiente.
11. **XML parser incompleto** — `tipo_comprobante`, `nombre_emisor`, `nombre_receptor` nunca se extraen.
12. **Columnas fantasma en payments** — `sat_status`, `payment_state`, `clabe_origin` nunca se escriben.
13. **Roles no se aplican** — definidos en DB pero no hay enforcement en API routes (cualquier user puede hacer cualquier operación).

### MENORES (calidad/consistencia)
14. **No hay `updated_at`** en customers, vendors, invoices, cfdi_documents.
15. **Dedup de pagos Odoo por `reference_id`** puede fallar con refs duplicadas.
16. **Catch-all route tiene 1125 líneas** — debería dividirse en archivos separados.
17. **Polling agresivo** — SyncStatus cada 2s, payments poll cada 15s, sin backoff.
18. **Legacy password fallback** — auth-server.ts permite login con password en texto plano.
19. **Sin paginación** en listas de vendors, customers, invoices (cargan todo).
20. **Sin retry logic** en llamadas a APIs externas (Fintoc, Odoo, SAT).
