# Plan de Refactorización — Fintoc App

> Objetivo: Eliminar duplicación de responsabilidades entre la app, Odoo 19+, Fintoc y Syntage.
> La app debe ser un **orquestador de flujos**, no una réplica de los sistemas externos.

---

## Arquitectura objetivo

```
┌─────────────────────────────────────────────────────┐
│                    TU APP (Next.js)                  │
│                                                      │
│  ┌──────────────┐  ┌───────────┐  ┌──────────────┐  │
│  │  Orquestación │  │ Dashboard │  │   Reglas de  │  │
│  │  de Pagos     │  │ Unificado │  │   Negocio    │  │
│  └──────┬───────┘  └─────┬─────┘  └──────┬───────┘  │
│         │                │               │           │
│  ┌──────┴────────────────┴───────────────┴───────┐   │
│  │              Capa de Integración Única         │   │
│  │         (1 cliente por plataforma)             │   │
│  └──────┬────────────────┬───────────────┬───────┘   │
└─────────┼────────────────┼───────────────┼───────────┘
          │                │               │
   ┌──────▼──────┐  ┌─────▼─────┐  ┌──────▼──────┐
   │  Odoo 19+   │  │  Fintoc   │  │  Syntage    │
   │  (ERP)      │  │  (Banco)  │  │  (SAT)      │
   │             │  │           │  │             │
   │ • Partners  │  │ • SPEI    │  │ • CFDIs     │
   │ • Facturas  │  │ • CLABEs  │  │ • EFOS      │
   │ • Pagos     │  │ • Saldos  │  │ • Compliance│
   │ • Reconcil. │  │ • Movim.  │  │ • Insights  │
   │ • Aging     │  │ • Webhooks│  │ • Webhooks  │
   │ • CFDI gen. │  │           │  │             │
   └─────────────┘  └───────────┘  └─────────────┘
```

### Supabase pasa de "réplica de todo" a:
- Autenticación y sesiones de usuario
- Reglas de aprobación y requests
- Tabla `payments` (orquestación propia)
- Audit log (acciones del usuario)
- Cache con TTL para performance del dashboard
- Configuración de integraciones (credenciales encriptadas)
- Webhook logs (idempotencia)

---

## Fase 1: Consolidar clientes duplicados (Semana 1-2)

### 1.1 Unificar clientes de Odoo

**Problema**: Dos implementaciones independientes con auth, error handling y patrones distintos.
- `src/lib/odoo.ts` — Clase `OdooClient` completa con ORM wrapper
- `src/lib/integrations/odoo.ts` — Funciones sueltas con `OdooConfig`

**Acción**:
- Mantener `src/lib/odoo.ts` como el único cliente (ya está diseñado para migración a JSON-2 REST API)
- Migrar todas las funciones de `src/lib/integrations/odoo.ts` para usar `OdooClient`
- Eliminar `src/lib/integrations/odoo.ts` como cliente independiente; convertirlo en funciones de alto nivel que usan `OdooClient`
- Agregar soporte para JSON-2 REST API de Odoo 19 como transport alternativo

**Archivos afectados**:
- `src/lib/odoo.ts` — mantener y extender
- `src/lib/integrations/odoo.ts` — refactorizar para usar OdooClient
- `src/lib/integrations/sync-engine.ts` — actualizar imports
- `src/app/api/sync/route.ts` — actualizar imports
- Tests: `src/lib/odoo.test.ts`

### 1.2 Unificar clientes de Fintoc

**Problema**: Dos implementaciones con signing JWS diferente (HS256 vs RS256).
- `src/lib/fintoc.ts` — Funciones con `crypto` RS256
- `src/lib/integrations/fintoc.ts` — Funciones con `jose` HS256, ApiError

**Acción**:
- Consolidar en `src/lib/fintoc.ts` como cliente único
- Usar el signing correcto según documentación de Fintoc (verificar cuál es el requerido)
- Mover la lógica de sync de `src/lib/integrations/fintoc.ts` a funciones de alto nivel
- Mantener idempotency key de Fintoc; eliminar la generación custom redundante

**Archivos afectados**:
- `src/lib/fintoc.ts` — mantener como cliente principal
- `src/lib/integrations/fintoc.ts` — refactorizar a funciones de alto nivel
- `src/lib/integrations/sync-engine.ts` — actualizar
- Tests correspondientes

### 1.3 Unificar clientes de Syntage

**Problema**: Dos implementaciones con rate-limiting y paginación diferentes.
- `src/lib/syntage.ts` — Clase `SyntageClient` completa
- `src/lib/integrations/syntage.ts` — Funciones con rate-limit tracking propio

**Acción**:
- Mantener `src/lib/syntage.ts` como cliente único (tiene cobertura más completa)
- Migrar lógica de sync a funciones de alto nivel que usan `SyntageClient`
- Unificar rate-limiting en un solo lugar

**Archivos afectados**:
- `src/lib/syntage.ts` — mantener
- `src/lib/integrations/syntage.ts` — refactorizar
- `src/lib/integrations/sync-engine.ts` — actualizar

### 1.4 Unificar implementaciones de EFOS

**Problema**: 3 implementaciones con interfaces distintas.
- `src/lib/sat.ts` → `parseEfosCode()` retorna `EfosStatus` enum
- `src/lib/integrations/syntage.ts` → `parseEfosCode()` retorna `{ isBlocked, isRisky }`
- `src/lib/syntage.ts` → `blacklistStatus` string mapping

**Acción**:
- Crear una sola función en `src/lib/utils/efos.ts`:
  ```typescript
  interface EfosResult {
    code: number;           // 200-204
    status: string;         // 'clean' | 'presumed' | 'disproved' | 'definitive' | 'favorable'
    isBlocked: boolean;     // true solo para 203
    isRisky: boolean;       // true para 201
    label: string;          // texto para UI
  }
  export function parseEfos(blacklistStatus: string | number): EfosResult
  ```
- Eliminar las 3 implementaciones existentes
- Preferir usar `blacklistStatus` directo de Syntage (ya viene procesado)

---

## Fase 2: Eliminar `sat.ts` — delegar a Syntage (Semana 2-3)

### 2.1 Eliminar validación SOAP directa al SAT

**Problema**: `src/lib/sat.ts` reimplementa lo que Syntage ya hace:
- `validateCfdiFullResponse()` — SOAP a ConsultaCFDI
- Builders de Descarga Masiva (autenticación, solicitud, verificación, descarga)
- `parseCfdiXml()` — parsing XML manual

**Acción**:
- Eliminar `validateCfdiFullResponse()` — usar `blacklistStatus` + `satStatus` de Syntage
- Eliminar builders de Descarga Masiva — Syntage hace bulk download vía extracciones
- Eliminar `parseCfdiXml()` — Syntage retorna JSON estructurado (endpoint CFDI con `Accept: application/json`)
- **Mantener** solo:
  - `validateRfc()` — validación de formato local, útil para UI
  - Tipos/interfaces que se usan en el resto de la app
- Renombrar archivo a `src/lib/utils/rfc.ts` o similar

**Archivos afectados**:
- `src/lib/sat.ts` — eliminar mayoría, mantener solo RFC validation
- `src/lib/sat.test.ts` — actualizar tests
- Cualquier archivo que importe funciones eliminadas de sat.ts
- API routes que llamen a validación SAT directa

### 2.2 Eliminar tabla `cfdi_documents`

**Problema**: Supabase almacena CFDIs completos que Syntage ya guarda.

**Acción**:
- Migrar queries que leen `cfdi_documents` para llamar a Syntage API directamente
- Mantener solo un campo `syntage_invoice_id` o `cfdi_uuid` como referencia en `invoices`
- Crear migration para eliminar tabla `cfdi_documents`
- Si se necesita cache por performance: usar Redis/cache en memoria con TTL de 5-15 min

**Archivos afectados**:
- Migration nueva para drop table
- API routes que lean cfdi_documents
- `src/lib/db.ts` si tiene helpers para cfdi_documents

### 2.3 Eliminar tabla `syntage_extractions`

**Problema**: Syntage trackea estado de extracciones nativamente.

**Acción**:
- Usar Syntage API para consultar estado de extracciones
- Confiar en webhooks `extraction.updated` para notificaciones
- Eliminar tabla y lógica de polling local

---

## Fase 3: Reducir réplicas de Odoo en Supabase (Semana 3-5)

### 3.1 Convertir `vendors` y `customers` de réplica a cache

**Problema**: Tablas `vendors` y `customers` son copias completas de `res.partner` de Odoo.

**Acción**:
- Cambiar el modelo a **cache con TTL**:
  - Mantener las tablas pero agregar campo `cache_expires_at`
  - En cada lectura: si expirado, refrescar desde Odoo API
  - TTL sugerido: 1 hora para listas, 5 min para detalle individual
- Reducir campos almacenados a solo lo necesario para UI rápida:
  - `id`, `company_id`, `odoo_id`, `name`, `rfc`, `efos_status`, `cache_expires_at`
  - Eliminar campos que solo se usan en detalle (address, phone, email) — cargar de Odoo on-demand
- `efos_status` sigue siendo valor agregado (dato de Syntage, no de Odoo)

**Alternativa** (si Odoo 19 REST API es suficientemente rápido):
- Eliminar tablas completamente
- Consultar Odoo directo con cache en memoria (SWR/React Query con staleTime)
- Solo mantener `efos_status` en Supabase como enriquecimiento

**Archivos afectados**:
- `src/lib/integrations/sync-engine.ts` — cambiar sync a cache refresh
- `src/lib/hooks/` — hooks de vendors/customers
- API routes de vendors/customers
- Dashboard components

### 3.2 Convertir `invoices` (fuente Odoo) de réplica a cache

**Problema**: Facturas de Odoo se copian completas incluyendo `amount_residual`, `payment_state` que se desactualizan.

**Acción**:
- Separar facturas por fuente:
  - `source='odoo'`: convertir a cache con TTL (misma estrategia que partners)
  - `source='syntage'`: eliminar — consultar Syntage directo
- Mantener en Supabase solo:
  - `id`, `company_id`, `odoo_move_id`, `uuid`, `source`, `sat_status`, `efos_status`, `cache_expires_at`
  - Datos frescos (amounts, payment_state) → cargar de Odoo/Syntage on-demand
- La tabla `invoices` se convierte en un **índice ligero** para búsqueda rápida + enriquecimiento SAT

### 3.3 Eliminar reporte aging propio

**Problema**: `/api/reports/aging` recalcula aging desde datos copiados que pueden estar desactualizados.

**Acción**:
- Opción A (recomendada): Llamar a Odoo 19 API para obtener el reporte de aging nativo (disponible vía accounting reports API)
- Opción B: Si Odoo API no expone reportes directamente, hacer query de `account.move` con `amount_residual > 0` agrupado por aging buckets directo de Odoo
- Eliminar endpoint `/api/reports/aging` o convertirlo en proxy a Odoo

### 3.4 Eliminar reconciliación propia

**Problema**: `reconciliation_entries` reimplementa matching que Odoo 19 hace nativamente (con AI mejorada, ~95% auto-match).

**Acción**:
- Estrategia: importar movimientos de Fintoc a Odoo como bank statements → dejar que Odoo reconcilie
- Crear función `importFintocMovementsToOdoo()`:
  1. Leer movimientos recientes de Fintoc API
  2. Crear `account.bank.statement.line` en Odoo vía API
  3. Odoo auto-reconcilia con su motor nativo
- Eliminar tabla `reconciliation_entries` y `reconciliations`
- Eliminar lógica de matching manual en la app

**Archivos afectados**:
- Nuevo: función de import Fintoc → Odoo bank statements
- Eliminar: lógica de reconciliación propia
- Migration para drop tables
- API routes de reconciliación

---

## Fase 4: Optimizar integración Fintoc (Semana 4-5)

### 4.1 Cambiar `bank_movements` de sync completo a histórico incremental

**Problema**: Se sincronizan 30 días de movimientos en cada sync, aunque Fintoc los sirve vía API.

**Acción**:
- Mantener `bank_movements` solo como **archivo histórico** (>12 meses que Fintoc puede no retener)
- Cambiar sync a solo movimientos nuevos (incrementales desde `last_sync_date`)
- Para consultas recientes: llamar a Fintoc API directo con cache de 5 min
- Agregar campo `archived_at` para distinguir datos archivados vs cache

### 4.2 Eliminar cache de saldos

**Problema**: `bank_accounts.balance` se desactualiza al instante después del sync.

**Acción**:
- Para dashboard: llamar a Fintoc `GET /accounts` directo (con cache SWR de 1-2 min)
- Mantener `bank_accounts` solo como referencia (fintoc_account_id, clabe, bank_name)
- Eliminar campo `balance` de la tabla o marcarlo como `last_known_balance` informativo

### 4.3 Usar reportes de reconciliación de Fintoc

**Problema**: La app no usa los CSVs de reconciliación que Fintoc genera automáticamente.

**Acción**:
- Investigar si Fintoc expone los reportes vía API (además de email/SFTP)
- Si sí: consumirlos para el dashboard de tesorería
- Si no: configurar SFTP y procesar CSVs automáticamente
- Esto complementa (no reemplaza) la reconciliación de Odoo

---

## Fase 5: Limpiar Supabase schema (Semana 5-6)

### 5.1 Tablas a eliminar

| Tabla | Razón | Reemplazo |
|---|---|---|
| `cfdi_documents` | Syntage almacena y sirve CFDIs | Consultar Syntage API |
| `syntage_extractions` | Syntage trackea extracciones nativamente | Consultar Syntage API |
| `reconciliation_entries` | Odoo 19 reconcilia nativamente | Importar movimientos a Odoo |
| `reconciliations` | Sesiones de reconciliación manual | Usar reconciliación de Odoo |
| `odoo_id_cache` | Cache redundante | Inline en queries |
| `odoo_bank_statements` | Odoo maneja statements nativamente | Importar via API |
| `odoo_purchase_orders` | Dato de Odoo | Consultar Odoo directo |

### 5.2 Tablas a simplificar (convertir a cache/índice)

| Tabla | Cambio |
|---|---|
| `vendors` | Reducir a: id, company_id, odoo_id, name, rfc, efos_status, cache_expires_at |
| `customers` | Reducir a: id, company_id, odoo_id, name, rfc, fintoc_account_number_id, cache_expires_at |
| `invoices` | Reducir a: id, company_id, odoo_move_id, uuid, source, type, sat_status, efos_status, cache_expires_at |
| `bank_accounts` | Eliminar balance; mantener como referencia estática |
| `bank_movements` | Solo archivo histórico (>12 meses); consultas recientes vía Fintoc API |

### 5.3 Tablas que se mantienen intactas

| Tabla | Razón |
|---|---|
| `companies` | Configuración propia de la app |
| `users` / `user_companies` | Auth y multi-tenancy propios |
| `payments` | Orquestación propia — fuente de verdad para el flujo |
| `invoice_payments` | Tracking de aplicación de pagos (orquestación) |
| `approval_rules` / `approval_requests` | Lógica de negocio propia (Odoo 19 no lo tiene nativo) |
| `expenses` | Mantener si hay flujo propio; evaluar si Odoo 19 expense cards lo reemplaza |
| `integrations` | Configuración de conexiones |
| `sync_history` / `sync_logs` | Observabilidad del sync |
| `audit_log` | Trazabilidad de acciones del usuario |
| `webhook_logs` / `webhook_events` | Idempotencia y debugging |
| `notifications` | Notificaciones in-app |
| `budgets` | Lógica propia |

---

## Fase 6: Migrar API de Odoo a JSON-2 REST (Semana 6-7)

### 6.1 Agregar transport JSON-2 a OdooClient

**Contexto**: Odoo 19 introduce JSON-2 REST API. JSON-RPC se elimina en Odoo 20 (fall 2026).

**Acción**:
- Agregar método de transport alternativo en `OdooClient`:
  ```typescript
  class OdooClient {
    private transport: 'jsonrpc' | 'json2rest' = 'jsonrpc';

    // Nuevo transport para Odoo 19+
    private async restRequest(model: string, method: string, args: any[]) {
      // GET /api/{model}/{id} para reads
      // POST /api/{model} para creates
      // PATCH /api/{model}/{id} para updates
      // DELETE /api/{model}/{id} para deletes
    }
  }
  ```
- Detectar versión de Odoo al conectar y usar transport apropiado
- Mantener JSON-RPC como fallback para Odoo <19

### 6.2 Usar API REST para queries directas

Con JSON-2 REST API, queries como obtener aging o partners son más eficientes:
```
GET /api/res.partner?domain=[["supplier_rank",">",0]]&fields=name,vat,email
GET /api/account.move?domain=[["amount_residual",">",0]]&fields=partner_id,amount_residual,invoice_date_due
```

Esto hace viable la estrategia de "consultar Odoo directo" sin el overhead de JSON-RPC.

---

## Fase 7: Mejorar tipado y testing (Semana 7-8)

### 7.1 Eliminar `any` types (121+ instancias)

**Prioridad por archivo**:
1. `src/lib/api.ts` (~90 instancias) — tipar responses de cada endpoint
2. `src/lib/integrations/` — tipar responses de Odoo, Fintoc, Syntage
3. `src/app/api/` — tipar request/response de API routes

**Acción**:
- Crear interfaces para cada response de API externa:
  ```typescript
  // src/types/odoo.ts
  interface OdooPartner { id: number; name: string; vat: string; ... }
  interface OdooInvoice { id: number; move_type: string; ... }

  // src/types/fintoc.ts
  interface FintocAccount { id: string; number: string; balance: { available: number } }
  interface FintocMovement { id: string; amount: number; post_date: string; ... }

  // src/types/syntage.ts
  interface SyntageInvoice { uuid: string; blacklistStatus: string; ... }
  ```
- Reemplazar `any` por interfaces específicas
- Agregar Zod schemas para validar responses en runtime

### 7.2 Agregar tests de componentes React

**Problema**: 0 tests de componentes UI.

**Acción**:
- Agregar Vitest + React Testing Library
- Priorizar tests para:
  1. `PermissionGate` — crítico para seguridad
  2. `DataTable` — componente más usado
  3. Flujo de aprobación de pagos — flujo de negocio crítico
  4. Dashboard principal — smoke test

### 7.3 Agregar tests de API routes

**Priorizar**:
1. `/api/payments/execute` — flujo crítico de negocio
2. `/api/payments/execute-batch` — operación masiva
3. `/api/auth/login` — seguridad
4. `/api/webhooks/*` — idempotencia y verificación de firma

---

## Fase 8: Mejoras de infraestructura (Semana 8-9)

### 8.1 Event sourcing para pagos

**Problema**: Sin log inmutable de transiciones de estado de pagos.

**Acción**:
- Crear tabla `payment_events` (append-only):
  ```sql
  CREATE TABLE payment_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES payments(id),
    event_type TEXT NOT NULL, -- 'created', 'approved', 'submitted_to_fintoc', 'confirmed', 'failed', 'cancelled'
    from_status TEXT,
    to_status TEXT,
    metadata JSONB,          -- fintoc_transfer_id, error details, etc.
    actor_id UUID,           -- user or 'system'
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  -- No UPDATE/DELETE allowed on this table
  ```
- Cada transición de estado escribe un evento antes de actualizar `payments.status`
- Permite reconstruir la historia completa de cualquier pago

### 8.2 Cola de mensajes para dual-write

**Problema**: Pago se escribe a Odoo y Fintoc secuencialmente; si uno falla, estado inconsistente.

**Acción**:
- Implementar patrón outbox con Supabase:
  ```sql
  CREATE TABLE outbox_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type TEXT NOT NULL,  -- 'payment'
    aggregate_id UUID NOT NULL,
    event_type TEXT NOT NULL,      -- 'execute_in_fintoc', 'register_in_odoo'
    payload JSONB NOT NULL,
    status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
    attempts INT DEFAULT 0,
    max_attempts INT DEFAULT 5,
    next_retry_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ
  );
  ```
- Procesador que lee outbox y ejecuta cada acción con retry + backoff
- Si Fintoc confirma pero Odoo falla: el evento de Odoo se reintenta sin afectar al usuario

### 8.3 Mejorar encriptación de credenciales

**Problema**: AES-GCM en app-level; una key comprometida expone todo.

**Acción**:
- Migrar a Supabase Vault (si disponible) o envelope encryption:
  - Master key en variable de entorno / KMS
  - Data encryption key (DEK) única por empresa
  - Rotar DEKs sin re-encriptar todo

---

## Orden de ejecución y dependencias

```
Fase 1 (Sem 1-2): Consolidar clientes     ← Sin dependencias, menor riesgo
     │
     ▼
Fase 2 (Sem 2-3): Eliminar sat.ts         ← Depende de Fase 1.3 (cliente Syntage unificado)
     │
     ▼
Fase 3 (Sem 3-5): Reducir réplicas Odoo   ← Depende de Fase 1.1 (cliente Odoo unificado)
     │                                        y Fase 2 (Syntage como fuente SAT)
     ▼
Fase 4 (Sem 4-5): Optimizar Fintoc        ← Depende de Fase 1.2 (cliente Fintoc unificado)
     │                                        Paralelo con Fase 3
     ▼
Fase 5 (Sem 5-6): Limpiar schema          ← Depende de Fases 2, 3, 4
     │
     ▼
Fase 6 (Sem 6-7): Migrar a JSON-2 REST    ← Depende de Fase 1.1 y 3
     │
     ▼
Fase 7 (Sem 7-8): Tipado y testing        ← Paralelo con cualquier fase
     │
     ▼
Fase 8 (Sem 8-9): Infraestructura         ← Independiente, puede empezar antes
```

---

## Métricas de éxito

| Métrica | Antes | Después |
|---|---|---|
| Tablas en Supabase | ~25+ | ~15 |
| Clientes de API duplicados | 6 (2 por plataforma) | 3 (1 por plataforma) |
| Implementaciones de EFOS | 3 | 1 |
| Instancias de `any` | 121+ | <10 |
| Tests de componentes | 0 | >20 |
| Tests de API routes | 0 | >10 |
| Datos desactualizados en Supabase | Constantemente (saldos, payment_state) | Solo cache con TTL explícito |
| Tiempo de sync completo | ~minutos (copia todo) | ~segundos (solo cache refresh) |
| Consistencia de pagos | Best-effort (secuencial) | Garantizada (outbox + retry) |

---

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Latencia al consultar APIs externas en vez de Supabase | Cache con TTL + SWR en frontend; datos críticos se pre-cargan |
| Fintoc/Syntage API downtime | Fallback a último dato en cache; mostrar badge "datos de hace X minutos" |
| Migración de datos existentes | Scripts de migración idempotentes; rollback plan para cada fase |
| Odoo 19 REST API diferencias | Feature flags para switch gradual JSON-RPC → REST |
| Rate limits de APIs externas | Centralizar rate limiting en cada cliente; usar batch endpoints donde existan |
| Pérdida de datos históricos al eliminar tablas | Backup antes de cada migration; retención de 90 días en archivo |
