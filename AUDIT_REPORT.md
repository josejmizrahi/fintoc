# Auditoría Profunda — Quimibond/Fintoc

**Fecha**: 2026-03-06
**Alcance**: Revisión completa de seguridad, arquitectura, calidad de código y flujos de negocio

## Resumen Ejecutivo

**Quimibond** es una plataforma financiera para empresas mexicanas construida con Next.js 16, React 19, Supabase/PostgreSQL, y TypeScript. Integra Fintoc (banca), Odoo (ERP), y Syntage (SAT). La arquitectura es sólida en muchos aspectos pero tiene vulnerabilidades críticas de seguridad y áreas de mejora importantes.

---

## LO QUE ESTÁ BIEN

### 1. Arquitectura General
- **Stack moderno y coherente**: Next.js 16 + App Router, React 19, TypeScript strict, Zod, TanStack Query.
- **Organización de carpetas clara**: `src/app/api`, `src/packages`, `src/lib/hooks`, `src/components`.
- **Separación en paquetes internos**: `packages/db`, `packages/integrations`, `packages/sync-engine`.

### 2. Seguridad — Aspectos Positivos
- **Validación con Zod en todos los endpoints**: Cada API route valida input con schemas Zod.
- **RBAC bien implementado**: Permisos granulares con roles admin, accountant, viewer.
- **Encriptación AES-256-GCM**: Credenciales de integración almacenadas con encriptación autenticada.
- **Timing-safe comparison** para webhooks de Fintoc (crypto.timingSafeEqual).
- **Rate limiting definido** por tipo de operación (auth, write, read, batch).
- **Sanitización de búsqueda**: sanitizeSearchParam elimina caracteres peligrosos en PostgREST.
- **Verificación EFOS**: Bloquea pagos a proveedores en lista EFOS definitiva.
- **Audit logging**: Registra operaciones críticas con writeAuditLog.
- **Idempotency keys** en transferencias Fintoc.
- **RLS** habilitado en todas las tablas de Supabase.

### 3. Calidad de Código
- **TypeScript strict** habilitado.
- **Capa de DB tipada** con createTableAccessor genérico.
- **Custom hooks organizados** por dominio.
- **Error handling centralizado** con createHandler.
- **ErrorCodes catalogados** con códigos HTTP correctos.
- **Paginación controlada** con límite máximo de 100 items.
- **Retry con exponential backoff** en cliente Fintoc.

### 4. Flujos de Negocio
- **Workflow de aprobaciones** configurable por montos.
- **Notificaciones automáticas** a aprobadores.
- **6 cron jobs** para sincronización diaria.
- **Reconciliación multi-fuente**: Banco vs App, SAT vs App, SAT vs Odoo.

---

## LO QUE ESTÁ MAL

### CRÍTICO — Seguridad

#### 1. Bypass de autenticación en middleware
- **Archivo**: `src/middleware.ts:35-38`
- Si Supabase falla, el middleware deja pasar requests sin autenticación (`NextResponse.next()`).
- **Fix**: Retornar 401 o 503 en el catch, nunca permitir acceso.

#### 2. Endpoint /api/setup público sin autenticación
- **Archivo**: `src/app/api/setup/route.ts`
- Permite ejecutar seedDB() con cualquier company_id sin autenticación.
- **Fix**: Proteger con auth de admin o eliminar en producción.

#### 3. Webhook de Odoo sin verificación obligatoria
- **Archivo**: `src/app/api/webhooks/odoo/route.ts:9`
- Si ODOO_WEBHOOK_TOKEN no está configurado, cualquiera puede enviar webhooks falsos.
- **Fix**: Hacer la verificación obligatoria.

### ALTO — Seguridad y Arquitectura

#### 4. Rate limiter solo en memoria (no funciona en serverless)
- **Archivo**: `src/lib/middleware/rate-limit.ts:9`
- Usa Map en memoria. En Vercel serverless, cada invocación tiene su propia memoria.
- **Fix**: Implementar con Upstash Redis.

#### 5. Todos los API routes bypasean RLS
- Todos los endpoints usan getAdminClient() (service role key) que bypasea RLS.
- La defensa en profundidad se pierde completamente.
- **Fix**: Usar client con token de usuario para queries regulares.

#### 6. Doble sistema de RBAC
- `src/lib/rbac.ts` usa formato `permissions:action` (con `:`)
- `src/lib/middleware/rbac.ts` usa formato `permissions.action` (con `.`)
- **Fix**: Unificar en una sola implementación.

#### 7. Memory leak: setInterval en módulo serverless
- **Archivo**: `src/lib/middleware/rate-limit.ts:52-59`
- setInterval en serverless no mantiene estado entre invocaciones.
- **Fix**: Eliminar o migrar a Redis.

### MEDIO — Calidad y Robustez

#### 8. Inyección en búsqueda global
- **Archivo**: `src/app/api/search/route.ts:13`
- El parámetro `q` se pasa sin sanitizar a filtros PostgREST.
- **Fix**: Aplicar sanitizeSearchParam.

#### 9. Políticas RLS inconsistentes
- Migraciones evolucionaron de auth_company_id() a JWT active_company_id con limpieza incompleta.
- Dos migraciones 016_* con nombres diferentes crean ambigüedad.
- **Fix**: Auditar y consolidar todas las políticas RLS.

#### 10. company_id como string | number
- **Archivo**: `src/lib/middleware/auth.ts:7`
- Tipo inconsistente se propaga por toda la app.
- **Fix**: Estandarizar a un solo tipo.

#### 11. Cero tests para flujos críticos
- No hay tests para ejecución de pagos, aprobaciones, ni reconciliación.
- Solo 15 archivos de test que cubren utilidades básicas.
- **Fix**: Agregar tests para lógica de negocio crítica.

#### 12. Error handling silencioso en audit log
- **Archivo**: `src/lib/middleware/audit.ts:25-28`
- Fallos de auditoría solo se logean a console.
- **Fix**: Implementar alerting para fallos de auditoría.

### BAJO — Mejoras Recomendadas

#### 13. No hay headers de seguridad (CSP, X-Frame-Options, CORS)
#### 14. No hay health check profundo (conectividad a servicios)
#### 15. No hay circuit breaker para integraciones externas
#### 16. console.error en vez de logging estructurado
#### 17. No hay SAST (eslint-plugin-security) configurado
#### 18. Companies INSERT policy abierta (WITH CHECK true)

---

## Tabla de Severidades

| Severidad | Cantidad | Issues |
|-----------|----------|--------|
| CRÍTICO   | 3        | Auth bypass, /api/setup público, webhook sin verificar |
| ALTO      | 4        | Rate limiter, RLS bypaseado, RBAC duplicado, memory leak |
| MEDIO     | 5        | Search injection, RLS inconsistente, tests faltantes, audit silencioso, types inconsistentes |
| BAJO      | 5        | Headers, health check, circuit breaker, logging, SAST |

## Recomendaciones Prioritarias (en orden)

1. Eliminar el catch silencioso en middleware.ts
2. Proteger /api/setup
3. Implementar rate limiting con Upstash Redis
4. Unificar el sistema RBAC
5. Agregar tests para flujos de pago
6. Hacer obligatoria la verificación de webhooks
7. Configurar headers de seguridad
8. Usar Supabase client con token de usuario para queries regulares
