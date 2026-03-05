# Estado Actual del Sistema — Fintoc + SAT + Odoo

## 1. Tablas en Supabase (17 tablas)

### Tabla: `companies`
| Columna | Tipo | Notas |
|---------|------|-------|
| id | SERIAL PK | |
| name | TEXT | |
| rfc | TEXT UNIQUE | RFC de la empresa |
| is_active | BOOLEAN | |
| onboarding_completed | BOOLEAN | default false |
| created_at | TIMESTAMPTZ | |

### Tabla: `users`
| Columna | Tipo | Notas |
|---------|------|-------|
| id | SERIAL PK | |
| auth_uid | UUID FK→auth.users | |
| email | TEXT UNIQUE | |
| password_hash | TEXT | |
| name | TEXT | |
| role | TEXT | admin/manager/accountant/viewer |
| company_id | FK→companies | |
| is_active | BOOLEAN | |
| created_at | TIMESTAMPTZ | |

### Tabla: `payments`
| Columna | Tipo | Poblado por Odoo | Poblado por Fintoc | Poblado manualmente |
|---------|------|:---:|:---:|:---:|
| id | SERIAL PK | | | |
| company_id | FK→companies | ✅ | ✅ | ✅ |
| direction | TEXT (inbound/outbound) | ✅ | ✅ | ✅ |
| status | TEXT | ✅ (hardcoded "confirmed") | ✅ (hardcoded "confirmed") | ✅ |
| amount | NUMERIC(15,2) | ✅ | ✅ | ✅ |
| currency | TEXT | ✅ | ✅ | ✅ |
| partner_name | TEXT | ✅ | ✅ | ✅ |
| partner_rfc | TEXT | ❌ NUNCA | ❌ NUNCA | ✅ |
| reference_id | TEXT | ✅ | ✅ | ✅ |
| clabe_origin | TEXT | ❌ NUNCA | ❌ NUNCA | ❌ NUNCA |
| clabe_destination | TEXT | ❌ NUNCA | ❌ NUNCA | ✅ |
| comment | TEXT | ❌ NUNCA | ❌ NUNCA | ✅ |
| scheduled_date | DATE | ❌ NUNCA | ❌ NUNCA | ✅ |
| fintoc_transfer_id | TEXT | ❌ | ✅ | ❌ |
| fintoc_payment_intent_id | TEXT | ❌ | ❌ | ✅ (al ejecutar) |
| executed_at | TIMESTAMPTZ | ✅ | ✅ | ✅ |
| sat_status | TEXT | ❌ NUNCA | ❌ NUNCA | ❌ NUNCA |
| payment_state | TEXT | ❌ NUNCA | ❌ NUNCA | ❌ NUNCA |
| created_at | TIMESTAMPTZ | auto | auto | auto |
| updated_at | TIMESTAMPTZ | ❌ | ❌ | ✅ |

**Problemas:**
- `partner_rfc`: Nunca se sincroniza. Odoo tiene el RFC en `res.partner.vat` pero el sync no lo asocia al pago.
- `clabe_origin`: Nunca se usa en todo el sistema.
- `sat_status` y `payment_state`: Columnas que existen pero nunca se escriben.
- No hay columna `odoo_id` para trackear el ID original de Odoo.
- No hay columna `source` para saber si el pago viene de Odoo o Fintoc.

---

### Tabla: `invoices`
| Columna | Tipo | Poblado por Odoo | Poblado por Fintoc | Poblado por SAT |
|---------|------|:---:|:---:|:---:|
| id | SERIAL PK | | | |
| company_id | FK→companies | ✅ | ✅ | |
| name | TEXT | ✅ | ✅ | |
| type | TEXT (receivable/payable) | ✅ | ✅ | |
| partner_name | TEXT | ✅ | ✅ | |
| partner_rfc | TEXT | ❌ NUNCA | ❌ NUNCA | |
| amount_total | NUMERIC(15,2) | ✅ | ✅ (÷100) | |
| amount_residual | NUMERIC(15,2) | ✅ | ✅ (=total) | |
| date_invoice | DATE | ✅ | ✅ | |
| date_due | DATE | ✅ | ❌ NUNCA | |
| status | TEXT | ✅ (open/cancelled/draft) | ✅ (hardcoded "open") | |
| cfdi_uuid | TEXT | ✅ | ✅ (usa institution_id) | |
| sat_status | TEXT | ❌ | ❌ | ✅ (update) |
| source | TEXT | ❌ NUNCA (null) | ✅ ("fintoc_fiscal") | |
| payment_state | TEXT | ❌ NUNCA | ❌ NUNCA | |
| created_at | TIMESTAMPTZ | auto | auto | |

**Problemas:**
- `partner_rfc`: Nunca se sincroniza. Odoo tiene `partner_id` pero no se extrae el RFC del partner.
- `source`: Solo Fintoc lo llena ("fintoc_fiscal"). Odoo no lo llena — no se puede distinguir origen.
- `date_due`: Fintoc nunca lo llena.
- `payment_state`: Columna que existe pero nunca se escribe.
- `cfdi_uuid` de Fintoc usa `institution_id` que NO es un UUID real del SAT.
- No hay columna `odoo_id` para trackear el ID original de Odoo.

---

### Tabla: `vendors`
| Columna | Tipo | Poblado por Odoo | Poblado manualmente |
|---------|------|:---:|:---:|
| id | SERIAL PK | | |
| company_id | FK→companies | ✅ | ✅ |
| name | TEXT | ✅ | ✅ |
| rfc | TEXT | ✅ (vat) | ✅ |
| email | TEXT | ✅ | ✅ |
| clabe | TEXT | ❌ NUNCA | ✅ |
| is_active | BOOLEAN | ❌ (default true) | ✅ |
| created_at | TIMESTAMPTZ | auto | auto |

**Problemas:**
- `clabe`: Solo se llena manualmente. Debería importarse de Odoo si existe (campo `l10n_mx_edi_payment_method_id` o banco).
- No hay columna `odoo_id` para trackear el ID original.
- No hay columna `phone` o `address`.

---

### Tabla: `customers`
| Columna | Tipo | Poblado por Odoo | Poblado manualmente |
|---------|------|:---:|:---:|
| id | SERIAL PK | | |
| company_id | FK→companies | ✅ | ✅ |
| name | TEXT | ✅ | ✅ |
| rfc | TEXT | ✅ (vat) | ✅ |
| email | TEXT | ✅ | ✅ |
| clabe | TEXT | ❌ NUNCA | ✅ |
| is_active | BOOLEAN | ❌ (default true) | ✅ |
| created_at | TIMESTAMPTZ | auto | auto |

**Problemas:**
- Mismos que vendors.
- No hay columna `odoo_id`.

---

### Tabla: `cfdi_documents`
| Columna | Tipo | Poblado por | Notas |
|---------|------|-------------|-------|
| id | SERIAL PK | | |
| company_id | FK→companies | upload XML | |
| uuid | TEXT UNIQUE | upload XML | UUID del timbre fiscal |
| tipo_comprobante | TEXT | ❌ NUNCA | I=Ingreso, E=Egreso, T=Traslado, P=Pago |
| rfc_emisor | TEXT | upload XML | Extraído del XML |
| nombre_emisor | TEXT | ❌ NUNCA | Existe pero nunca se parsea del XML |
| rfc_receptor | TEXT | upload XML | Extraído del XML |
| nombre_receptor | TEXT | ❌ NUNCA | Existe pero nunca se parsea del XML |
| total | NUMERIC(15,2) | upload XML | |
| sat_status | TEXT | revalidación | Vigente/Cancelado/No encontrado |
| fecha_emision | TIMESTAMPTZ | upload XML | |
| fecha_timbrado | TIMESTAMPTZ | upload XML | |
| xml_content | TEXT | upload XML | XML completo |
| created_at | TIMESTAMPTZ | auto | |

**Problemas:**
- `tipo_comprobante`: Nunca se extrae del XML (el parser no lo lee).
- `nombre_emisor` y `nombre_receptor`: Nunca se extraen del XML.
- No hay relación con `invoices` — un CFDI subido no se liga automáticamente a una factura.

---

### Tabla: `bank_movements`
| Columna | Tipo | Poblado por | Notas |
|---------|------|-------------|-------|
| id | SERIAL PK | | |
| company_id | FK→companies | ❌ NUNCA | |
| fintoc_id | TEXT | ❌ NUNCA | |
| amount | NUMERIC(15,2) | ❌ NUNCA | |
| currency | TEXT | ❌ NUNCA | |
| description | TEXT | ❌ NUNCA | |
| post_date | TIMESTAMPTZ | ❌ NUNCA | |
| type | TEXT (credit/debit) | ❌ NUNCA | |
| reference_id | TEXT | ❌ NUNCA | |
| sender_account | TEXT | ❌ NUNCA | |
| created_at | TIMESTAMPTZ | ❌ NUNCA | |

**PROBLEMA GRAVE: Esta tabla existe pero NUNCA se usa.** Los movimientos de Fintoc van directo a `payments` en lugar de guardarse aquí. Esta tabla fue diseñada para almacenar movimientos bancarios raw pero el sync los ignora completamente.

---

### Tabla: `expenses`
| Columna | Tipo | Notas |
|---------|------|-------|
| id | SERIAL PK | |
| company_id | FK→companies | |
| employee_name | TEXT | |
| employee_email | TEXT | |
| category | TEXT | |
| description | TEXT | |
| amount | NUMERIC(15,2) | |
| currency | TEXT | |
| status | TEXT | draft/submitted/approved/rejected/paid |
| cfdi_uuid | TEXT | Puede ligarse a un CFDI |
| sat_validated | BOOLEAN | default false |
| created_at | TIMESTAMPTZ | |

**Problemas:**
- `sat_validated` nunca se actualiza automáticamente — debería validarse cuando se ingresa `cfdi_uuid`.
- No se importan gastos de Odoo.

---

### Tabla: `integrations`
| Columna | Tipo | Notas |
|---------|------|-------|
| id | SERIAL PK | |
| company_id | FK→companies | |
| provider | TEXT | odoo/fintoc/sat/general |
| is_connected | BOOLEAN | |
| config | JSONB | Credenciales (masked en respuesta) |
| last_sync_at | TIMESTAMPTZ | |
| last_sync_status | TEXT | |
| last_sync_message | TEXT | |
| cert_serial | TEXT | Serial del certificado SAT |
| cert_expires_at | TIMESTAMPTZ | Vencimiento del cert |
| cert_uploaded_at | TIMESTAMPTZ | Fecha de subida |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

### Tabla: `sync_logs`
| Columna | Tipo | Notas |
|---------|------|-------|
| id | SERIAL PK | |
| company_id | FK→companies | |
| provider | TEXT | odoo/fintoc/sat |
| sync_type | TEXT | full/incremental/revalidate |
| status | TEXT | running/success/partial/error |
| total_items | INTEGER | |
| processed_items | INTEGER | |
| details | JSONB | Desglose por fase |
| error_message | TEXT | |
| started_at | TIMESTAMPTZ | |
| completed_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | |

### Otras tablas (funcionales, sin problemas de sync)
- `approval_rules` — Reglas de aprobación por monto
- `approval_requests` — Solicitudes de aprobación individuales
- `budgets` — Presupuestos con tracking de gasto
- `notifications` — Notificaciones in-app
- `reconciliations` — Historial de conciliaciones
- `reconciliation_entries` — Detalle de cada entrada de conciliación

---

## 2. Flujo de Sincronización Actual

### Odoo Sync
```
res.partner (customer_rank > 0) → customers (name, rfc, email)
res.partner (supplier_rank > 0) → vendors (name, rfc, email)
account.move (in/out_invoice)   → invoices (all fields except partner_rfc, source)
account.payment (posted/sent)   → payments (all except partner_rfc, clabes)
```

### Fintoc Sync
```
/accounts/{id}/movements (30 días) → payments (como confirmed, con fintoc_transfer_id)
/invoices (con link_token)         → invoices (amounts ÷100, cfdi_uuid=institution_id)
```

### SAT Sync
```
invoices WHERE cfdi_uuid IS NOT NULL → UPDATE invoices.sat_status (Vigente/Cancelado/etc)
```

---

## 3. Resumen de Problemas Encontrados

### CRÍTICOS
1. **`bank_movements` tabla completamente vacía** — Fintoc movements van a `payments` directamente, no se guardan como movimientos bancarios separados.
2. **`partner_rfc` nunca se sincroniza** en `payments` ni `invoices` — imposible hacer match por RFC.
3. **No hay `odoo_id`** en ninguna tabla — no se puede hacer match bidireccional con Odoo.
4. **Fintoc `cfdi_uuid` es `institution_id`** — NO es un UUID real del SAT, no sirve para validación.
5. **`source` solo se llena para Fintoc** — no se puede distinguir facturas importadas de Odoo vs manuales.

### IMPORTANTES
6. **Odoo no importa CLABE** de partners — campo disponible en Odoo pero no en el sync.
7. **No se sincronizan gastos** de Odoo — tabla `expenses` es solo manual.
8. **`sat_validated` en expenses** nunca se actualiza automáticamente.
9. **`tipo_comprobante`** en cfdi_documents nunca se extrae del XML.
10. **`nombre_emisor`/`nombre_receptor`** en cfdi_documents nunca se extraen.
11. **cfdi_documents no se ligan a invoices** — subir un XML no busca/crea la factura correspondiente.
12. **`sat_status` y `payment_state` en payments** — columnas que nunca se escriben.
13. **`clabe_origin` en payments** — columna que nunca se usa en todo el sistema.

### MENORES
14. **No hay `updated_at`** en customers, vendors, invoices, cfdi_documents.
15. **Dedup de pagos Odoo por `reference_id`** puede fallar si Odoo genera refs duplicadas.
16. **SAT sync usa `rfcEmisor` como emisor Y receptor** — incorrecto para facturas recibidas.
