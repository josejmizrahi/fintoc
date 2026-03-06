# Supabase – Migraciones post reestructuración

Tras aplicar el commit de reestructuración arquitectónica, ejecuta estas migraciones en tu proyecto Supabase **en orden**:

1. **017_drop_dead_tables.sql** – Elimina tablas sin uso:  
   `reconciliation_entries`, `cfdi_documents`, `sync_logs`,  
   `sat_cancellation_requests`, `sat_download_requests`, `rfc_validations`.

2. **018_drop_bank_movements.sql** – Elimina `bank_movements`.  
   Los movimientos se consultan en tiempo real desde la API de Fintoc.

3. **019_drop_odoo_aux_tables.sql** – Elimina tablas auxiliares Odoo:  
   `odoo_bank_statements`, `odoo_purchase_orders`, `odoo_id_cache`.

## Cómo aplicarlas

**Opción A – Supabase CLI (recomendado)**  
Con el proyecto enlazado (`supabase link`):

```bash
supabase db push
```

**Opción B – Dashboard de Supabase**  
En SQL Editor, ejecuta el contenido de cada archivo en el orden 017 → 018 → 019.

**Opción C – Migraciones ya aplicadas**  
Si tu remoto ya tiene un schema más reciente (p. ej. después de `016_full_schema_reset.sql`), estas migraciones solo hacen `DROP TABLE IF EXISTS ... CASCADE`, por lo que son seguras aunque la tabla no exista.

## Comprobación

- No debe haber referencias en el código a las tablas eliminadas (salvo etiquetas de UI).
- Tras aplicar las migraciones, el schema queda alineado con `src/types/database.ts`.
