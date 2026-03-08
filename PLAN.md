# Plan de Mejoras Funcionales - Quimibond

## Estado actual

La app cubre: Dashboard, Pagos SPEI (Fintoc), Cobranza, Facturas (CxP/CxC), Proveedores, Clientes, Gastos, Tesoreria, Presupuestos, Aprobaciones, SAT (Syntage), Conciliacion (SAT-Odoo, SAT-App, Banco-App), Reportes y Configuracion. Integraciones con Fintoc, Syntage/SAT, Odoo ERP y Resend email.

---

## Fase 1: Quick wins (alto impacto, baja complejidad)

### 1.1 Exportacion de reportes a Excel/PDF
- Agregar boton "Exportar" en cada reporte (cash-flow, aging, vendor/customer summary, SAT compliance)
- Formato Excel via `xlsx` (o `exceljs`) y PDF via `@react-pdf/renderer`
- Incluir filtros aplicados en el archivo exportado
- **Archivos afectados:** `src/app/(dashboard)/reportes/page.tsx`, nuevo `src/lib/utils/export.ts`

### 1.2 Notificaciones push en el dashboard
- Actualmente hay notificaciones pero son pasivas (hay que ir a verlas)
- Agregar badge de conteo en el sidebar y bell icon en el header
- Notificaciones en tiempo real via Supabase Realtime (suscripcion a tabla `notifications`)
- **Archivos afectados:** `src/components/layout/header.tsx`, nuevo `src/lib/hooks/use-realtime-notifications.ts`

### 1.3 Calendario de pagos programados
- Vista calendario (mensual/semanal) de pagos programados y facturas por vencer
- Drag & drop para reprogramar pagos
- Colores por status (pendiente, vencido, pagado)
- **Archivos afectados:** nuevo `src/app/(dashboard)/pagos/_components/payment-calendar.tsx`

### 1.4 Busqueda global (Command Palette)
- Cmd+K para buscar en toda la app: facturas, pagos, clientes, proveedores
- Resultados agrupados por seccion con navegacion directa
- **Archivos afectados:** nuevo `src/components/shared/command-palette.tsx`, `src/app/(dashboard)/layout.tsx`

---

## Fase 2: Mejoras de flujos existentes (impacto medio-alto)

### 2.1 Conciliacion automatica inteligente
- Actualmente la conciliacion es manual (el usuario revisa discrepancias)
- Auto-matching de movimientos bancarios con facturas por monto, fecha y referencia
- Scoring de confianza (match exacto, parcial, sugerido)
- Boton "Conciliar automaticamente" que aplica matches con confianza > 90%
- **Archivos afectados:** nuevo `src/lib/reconciliation/auto-match.ts`, API route, tabs de conciliacion

### 2.2 Flujo de caja proyectado con escenarios
- Ya existe forecast basico en tesoreria
- Agregar escenarios: optimista (cobros a tiempo), pesimista (retrasos), realista
- Alertas de posible iliquidez con X dias de anticipacion
- Graficas comparativas de escenarios
- **Archivos afectados:** `src/app/(dashboard)/tesoreria/page.tsx`, `src/app/api/treasury/forecast/route.ts`

### 2.3 Complementos de pago CFDI 2.0
- Generacion automatica de complementos de pago al registrar cobros
- Vinculacion factura-pago con tracking del saldo pendiente
- Validacion de reglas SAT (parcialidades, tipo de cambio)
- **Archivos afectados:** nuevo `src/app/api/sat/payment-complement/route.ts`, integracion en cobranza

### 2.4 Portal de clientes (autoservicio)
- URL publica por cliente donde puede ver sus facturas pendientes y pagar
- Pago directo via link de pago (ya existe `payment-links` API)
- Descarga de facturas y complementos de pago
- Historial de pagos del cliente
- **Archivos afectados:** nueva ruta `src/app/portal/[token]/page.tsx`

---

## Fase 3: Funcionalidades nuevas (alto impacto, alta complejidad)

### 3.1 Multi-moneda (USD, EUR)
- Soporte de facturas y pagos en monedas extranjeras
- Tipo de cambio automatico via API del Banxico/DOF
- Diferencias cambiarias automaticas en contabilidad
- Dashboard de exposicion cambiaria en tesoreria
- **Archivos afectados:** esquema de BD, formatMoney, pagos, facturas, tesoreria

### 3.2 Dashboard personalizable
- Widgets arrastrables: KPIs, graficas, tablas resumidas
- Cada usuario puede configurar su propio dashboard
- Presets por rol (CFO, contador, tesorero)
- **Archivos afectados:** `src/app/(dashboard)/page.tsx`, nuevo sistema de widgets

### 3.3 Audit trail visible y filtrable
- Ya existe `src/app/api/audit/route.ts` pero no hay UI
- Pagina de historial de actividad con filtros por usuario, accion, entidad, fecha
- Timeline visual de cambios por registro (ej: historial de una factura)
- Exportable para auditores externos
- **Archivos afectados:** nuevo `src/app/(dashboard)/auditoria/page.tsx`

### 3.4 Reglas de negocio configurables
- Ya existen reglas de aprobacion basicas
- Expandir a: alertas por monto, bloqueo de proveedores EFOS automatico, limites de gasto por departamento
- Motor de reglas flexible (condicion -> accion)
- **Archivos afectados:** `src/app/(dashboard)/configuracion/`, `src/app/api/approvals/rules/`

---

## Fase 4: Diferenciadores (ventaja competitiva)

### 4.1 Analisis predictivo de cobranza
- ML basico: predecir probabilidad de pago por cliente basado en historial
- Score de riesgo por cliente con recomendacion de limites de credito
- Alertas proactivas: "Cliente X tiene 80% probabilidad de retrasar pago"

### 4.2 Integracion con DIOT y declaraciones
- Generacion automatica de DIOT desde facturas de proveedores
- Pre-llenado de declaraciones mensuales de IVA
- Calculo automatico de retenciones (ISR, IVA)

### 4.3 Conciliacion contable con Odoo
- Asientos contables automaticos desde pagos y cobros
- Cierre mensual guiado con checklist
- Diferencias entre saldo contable y saldo bancario con explicacion

### 4.4 API publica para integraciones de terceros
- API REST documentada con Swagger/OpenAPI
- Webhooks configurables para eventos (pago recibido, factura vencida)
- API keys por empresa con scopes

---

## Orden de implementacion sugerido

| Prioridad | Item | Esfuerzo | Impacto |
|-----------|------|----------|---------|
| 1 | Exportacion Excel/PDF | 2-3 dias | Alto |
| 2 | Busqueda global (Cmd+K) | 2 dias | Alto |
| 3 | Notificaciones realtime | 2-3 dias | Medio |
| 4 | Calendario de pagos | 3-4 dias | Medio |
| 5 | Conciliacion automatica | 5-7 dias | Alto |
| 6 | Flujo de caja con escenarios | 3-5 dias | Alto |
| 7 | Audit trail UI | 3-4 dias | Medio |
| 8 | Portal de clientes | 5-7 dias | Alto |
| 9 | Complementos de pago CFDI | 5-7 dias | Alto |
| 10 | Multi-moneda | 7-10 dias | Medio |
| 11 | Dashboard personalizable | 5-7 dias | Medio |
| 12 | Reglas de negocio | 5-7 dias | Medio |
| 13 | DIOT/declaraciones | 7-10 dias | Alto |
| 14 | Analisis predictivo | 7-10 dias | Medio |
| 15 | API publica | 7-10 dias | Medio |
| 16 | Conciliacion contable Odoo | 5-7 dias | Medio |
