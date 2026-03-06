# Auditoría: Supabase y App — qué falta para que todo funcione

Revisión cruzada del esquema Supabase (migraciones, RLS), APIs y frontend para detectar huecos e incoherencias.

---

## 1. Resumen ejecutivo

- **Supabase**: Esquema actual (post 016 + 017–020) es coherente. RLS por `company_id` y JWT `active_company_id::int`. Tablas eliminadas (sync_logs, bank_movements, reconciliation_entries, etc.) ya no se usan en el código.
- **App**: Casi todo está implementado. Los puntos críticos corregidos o pendientes se listan abajo.
- **Corrección aplicada en esta revisión**: Crear regla de aprobación desde la UI (el formulario envía `min_amount`/`max_amount` y la API esperaba `amount_min`/`amount_max`). El POST de reglas ahora acepta ambos y escribe en ambas columnas.

---

## 2. Supabase — estado actual

### 2.1 Tablas existentes (post 017–020)

| Tabla | Uso en app |
|-------|------------|
| companies, users, user_companies | Auth, multi-empresa, onboarding |
| integrations | Odoo, Fintoc, SAT (config, last_sync_*) |
| vendors, customers | Proveedores/clientes; sync Odoo partners |
| invoices | Facturas por pagar/cobrar; sync Odoo + Syntage webhook |
| payments | Pagos, aprobaciones, Fintoc webhook |
| invoice_payments, cfdi_complements | Relación pago–factura, complementos |
| expenses | Gastos, aprobación |
| approval_rules, approval_requests | Reglas y solicitudes de aprobación |
| budgets | Presupuestos |
| notifications | Notificaciones (read, is_read) |
| reconciliations | Solo cabecera; sin reconciliation_entries |
| bank_accounts | Tesorería, Fintoc |
| sync_history | Historial de sync (odoo, fintoc, syntage) |
| syntage_extractions | Extracciones SAT (Syntage) |
| audit_log | Auditoría (solo lectura vía RLS) |
| webhook_logs, webhook_events | Webhooks Fintoc, Syntage, Odoo |

### 2.2 RLS

- Todas las tablas tenant usan `company_id = (auth.jwt() ->> 'active_company_id')::int`.
- `companies`: acceso por membresía en `user_companies`.
- `notifications`: filtro por `user_id` y `company_id`.
- `audit_log`: solo SELECT por company.
- `webhook_logs`: `company_id` puede ser NULL en esquema; la app puede enviarlo cuando lo tenga.

### 2.3 Migraciones aplicadas en esta revisión

- **020_fix_invoice_type_odoo_sync.sql**: Corrige `invoices.type` de valores Odoo (`in_invoice`, `out_invoice`, etc.) a `payable`/`receivable` para que las facturas aparezcan en las pestañas de Facturas.

---

## 3. App — endpoints y flujos

### 3.1 Rutas que dependen de Supabase

- Auth: login, register, refresh, switch-company, me.
- Onboarding: GET/POST `/api/onboarding` (usa `lib/db` query/update sobre `integrations`, `companies`).
- Dashboard: GET `/api/dashboard` (bank_accounts, invoices, payments).
- Reportes: `/api/reports/cash-flow` (payments con `confirmed_at`).
- Facturas: payable/receivable desde `invoices`; sync Odoo escribe con `type` = payable/receivable.
- Proveedores/Clientes: CRUD + sync partners; `vendors.synced_at` usado por sync-engine.
- Pagos: CRUD, execute, cancel, retry; matching de reglas por `approval_rules.amount_min`/`amount_max`.
- Aprobaciones: pending, approve (`[id]/approve`), reject (`[id]/reject`), rules (GET/POST).
- Tesorería: snapshot, balance, movements (Fintoc API), accounts; **cash-flow** es stub (devuelve `[]`); el dashboard usa `api.reports.cashFlow`, no treasury cash-flow.
- Conciliación: sat-odoo, sat-app, banco-app (Fintoc + payments).
- SAT: validate, cancel, syntage, etc.
- Webhooks: Fintoc, Syntage, Odoo (webhook_logs, payments, invoices, notifications).
- Sync: v2/sync (odoo, fintoc, sat/syntage stub); sync/odoo/partners.
- Sync-logs: GET desde `sync_history` (orden por `started_at`).

### 3.2 Stubs (no críticos para flujo principal)

- `GET /api/treasury/cash-flow`: stub que devuelve `[]`. El gráfico de flujo en el dashboard usa `api.reports.cashFlow` → `/api/reports/cash-flow`, que sí está implementado.
- `GET /api/reconciliation/history`: stub que devuelve `[]`. Útil para una futura pantalla de historial de conciliaciones.

---

## 4. Lo que faltaba y se corrigió

### 4.1 Facturas vacías tras sync Odoo

- **Causa**: El sync guardaba `type = move_type` de Odoo (`in_invoice`, `out_invoice`) y la app filtra por `type = 'payable'` / `'receivable'`.
- **Corrección**: En sync-engine se mapea a `payable`/`receivable` y se rellenan `date_invoice`, `date_due`, `odoo_*`. Migración 020 actualiza filas ya sincronizadas.

### 4.2 Crear regla de aprobación desde la UI

- **Causa**: El formulario envía `min_amount`, `max_amount` y la API validaba `amount_min`, `amount_max`; el POST fallaba.
- **Corrección**: En `POST /api/approvals/rules` se aceptan `min_amount`/`max_amount` y se normalizan a `amount_min`/`amount_max`; al insertar se guardan ambas parejas para compatibilidad con el matching de pagos y con la UI.

---

## 5. Pendientes / recomendaciones

### 5.1 Reglas de aprobación existentes (seed o datos viejos)

- Si hay filas con `min_amount`/`max_amount` pero `amount_min`/`amount_max` NULL, el matching de pagos (que usa `amount_min`/`amount_max`) puede no aplicarlas.
- **Recomendación**: Migración opcional:
  ```sql
  UPDATE approval_rules
  SET amount_min = COALESCE(amount_min, min_amount, 0),
      amount_max = COALESCE(amount_max, max_amount)
  WHERE amount_min IS NULL OR amount_max IS NULL;
  ```

### 5.2 Permisos pendientes en Aprobaciones

- **GET /api/approvals/pending** está protegido con `approvals.manage`. La pestaña “Pendientes” la ven aprobadores; si solo los admins tienen `approvals.manage`, conviene revisar RBAC (p. ej. permiso `expenses.approve` o `approvals.read` para ver pendientes sin gestionar reglas).

### 5.3 Onboarding y auth

- **GET/POST /api/onboarding** usan `lib/db` (query/update) y `getCompanyId` desde headers/token. Asegurar que en producción el JWT incluya `active_company_id` y que `getCompanyId` devuelva el mismo tipo (número) que `company_id` en Supabase.

### 5.4 Notificaciones

- La tabla tiene `read` e `is_read`; la app actualiza ambas. Mantener ambas en sync o deprecar una en una migración futura para evitar confusión.

### 5.5 Webhook_logs y company_id

- `webhook_logs.company_id` es nullable. Si algún webhook se procesa antes de identificar empresa, puede quedar NULL; la política RLS que filtra por `company_id` puede ocultar esas filas. Si se quiere ver todos los logs por proveedor, considerar política adicional o endpoint admin.

### 5.6 Sync-history y created_at

- `sync_history` tiene `started_at`, `completed_at`; no hay `created_at`. El sync-engine no escribe `created_at`. Todo consistente; solo documentar que la “fecha de inicio” es `started_at`.

### 5.7 Semilla (lib/db.ts seedDB)

- Inserta en payments, invoices, vendors, customers, expenses, approval_rules, budgets, notifications, reconciliations. Las reglas usan `min_amount`, `approver_emails`; no rellenan `amount_min`/`amount_max` ni `approvers` (UUIDs). Para que el matching de pagos use esas reglas, ejecutar la migración sugerida en 5.1 o rellenar `amount_min`/`amount_max` en el seed.

---

## 6. Checklist rápido de “todo funciona”

- [x] Login/registro y switch de empresa.
- [x] Onboarding: guardar y probar Odoo, Fintoc, SAT.
- [x] Dashboard: KPIs y gráfico de flujo (reports/cash-flow).
- [x] Facturas: listar por pagar/cobrar; sync Odoo rellena con tipo correcto.
- [x] Proveedores/Clientes: listar y sync “Proveedores y clientes” (Odoo).
- [x] Pagos: crear, aprobar, ejecutar; matching por reglas (amount_min/amount_max).
- [x] Aprobaciones: ver pendientes, aprobar, rechazar; crear reglas desde la UI.
- [x] Tesorería: cuentas y movimientos (Fintoc); balance actualizado.
- [x] Conciliación: sat-odoo, sat-app, banco-app.
- [x] SAT / Syntage: estado, extracciones, validación.
- [ ] Stubs: treasury/cash-flow y reconciliation/history siguen devolviendo array vacío (opcional implementar más adelante).

---

## 7. Variables de entorno y despliegue

- **Supabase**: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- **Auth**: JWT con claim `active_company_id` (entero) vía custom_access_token_hook o middleware.
- **Fintoc / Odoo / Syntage**: según `.env.example`; no hardcodear secretos.

Con las correcciones de facturas (tipo Odoo) y de reglas de aprobación (min/max vs amount_min/amount_max), el flujo principal de la app y Supabase queda alineado y operativo. El resto son mejoras opcionales (migración de reglas antiguas, permisos de aprobaciones, limpieza de notificaciones y webhook_logs).
