# Qué ver en cada página

Guía rápida de qué datos muestra cada pantalla y **de dónde vienen** (Odoo, Fintoc, SAT, manual).

---

## Por qué no veo información de Odoo

La información de Odoo **solo aparece después de**:

1. **Conectar Odoo**  
   En **Configuración → Integraciones** (o en el onboarding): URL, base de datos, usuario y API Key. Debe estar en verde “Conectado”.

2. **Ejecutar la sincronización correcta**  
   No basta con conectar; hay que disparar el sync según lo que quieras ver:
   - **Facturas** → Sincronizar **Odoo** (facturas): botón en Facturas o en el header “Sincronizar”.
   - **Proveedores y clientes** → Sincronizar **“Proveedores y clientes”** (Odoo): en Configuración → Integraciones, en la tarjeta de Odoo, o en Proveedores → menú ⋮ → “Sync desde Odoo”.

Si Odoo no está conectado o no has corrido el sync correspondiente, las tablas estarán vacías y las pantallas mostrarán “Sin datos” o ceros.

---

## Dashboard (inicio)

| Qué ves | Origen |
|--------|--------|
| **Saldo actual** | Cuentas bancarias (Fintoc). Necesitas Fintoc conectado y sync de cuentas. |
| **Por cobrar / Por pagar / Vencidas** | Facturas en Supabase (`invoices`). Para ver datos de Odoo: conectar Odoo y **Sincronizar Odoo** (facturas). |
| **Gráfico de flujo de caja** | API de reportes (usa facturas y movimientos). |
| **Integraciones** | Estado Odoo, Fintoc, SAT (conectado / última sync). |

---

## Proveedores

| Qué ves | Origen |
|--------|--------|
| Lista de proveedores | Tabla `vendors` en Supabase. |
| Datos de Odoo | Solo después de **“Proveedores y clientes”** (sync Odoo partners): Configuración → Integraciones → botón en Odoo, o en Proveedores → ⋮ → “Sync desde Odoo”. |
| Crear / editar / CLABE / RFC / EFOS | Manual en la app o datos ya traídos por el sync. |

---

## Clientes

| Qué ves | Origen |
|--------|--------|
| Lista de clientes | Tabla `customers`. |
| Datos de Odoo | Mismo sync **“Proveedores y clientes”** (actualiza proveedores y clientes desde Odoo). |

---

## Facturas

| Qué ves | Origen |
|--------|--------|
| Por pagar / Por cobrar | Tabla `invoices` (filtrando por tipo). |
| Facturas de Odoo | Después de **Sincronizar Odoo** (solo facturas): botón en Facturas o header “Sincronizar”. |
| UUID, forma de pago, uso CFDI | Campos que vienen del sync de Odoo (`odoo_cfdi_uuid`, `odoo_payment_method`, etc.) o de SAT/Syntage. |

---

## Pagos

| Qué ves | Origen |
|--------|--------|
| Lista de pagos | Tabla `payments` (creados en la app o desde aprobaciones). |
| `odoo_id` / `odoo_state` | Si el pago se envió a Odoo; depende de integración y flujo posterior al pago. |

---

## Tesorería

| Qué ves | Origen |
|--------|--------|
| Saldo y cuentas | Fintoc (API de cuentas). |
| Movimientos | API de Fintoc (no se guardan en DB), filtros por fecha/tipo. |

---

## Conciliación

| Qué ves | Origen |
|--------|--------|
| **SAT vs Odoo** | Compara facturas en SAT (Syntage) con facturas en Odoo (las que ya sincronizaste). Necesitas sync Odoo facturas y datos SAT. |
| **SAT vs App** | Facturas en SAT vs facturas en la app. |
| **Banco vs App** | Movimientos Fintoc vs movimientos/pagos en la app. |

---

## Cobranza

Facturas por cobrar (tipo receivable), links de pago, recordatorios. Los receivable vienen de lo que tengas en `invoices` (manual o sync Odoo).

---

## SAT

Contribuyentes, facturas CFDI, extracciones, estado fiscal, obligaciones, retenciones. Todo vía **Syntage** (SAT); no depende de Odoo.

---

## Aprobaciones / Gastos / Presupuestos / Reportes

Son módulos propios de la app (solicitudes, reglas, gastos, presupuestos, reportes). Odoo no llena estas pantallas; pueden usar proveedores o facturas ya sincronizados.

---

## Resumen: pasos para ver datos de Odoo

1. **Configuración → Integraciones**: conectar **Odoo** (URL, DB, usuario, API Key) y, si aplica, **Fintoc** y **SAT (Syntage)**.
2. **Sincronizar facturas desde Odoo**: en **Facturas** o en el header “Sincronizar” (elige Odoo). Así se llenan Dashboard “Por pagar / Por cobrar” y la lista de facturas.
3. **Sincronizar proveedores y clientes**: en **Configuración → Integraciones** en la tarjeta de Odoo → “Proveedores y clientes”, o en **Proveedores** → ⋮ → “Sync desde Odoo”. Así se llenan Proveedores y Clientes.

Si tras esto sigues sin ver datos, revisa: que la empresa activa (selector de empresa) sea la correcta, que en Odoo existan facturas/socios para esa empresa, y la consola del navegador o logs del backend por errores en el sync.
