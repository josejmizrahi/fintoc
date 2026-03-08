/* ---------- Types ---------- */

export interface ReconciliationPeriod {
  period_start: string;
  period_end: string;
}

export interface ReconciliationRecord {
  id?: string;
  uuid?: string;
  rfc_emisor?: string;
  rfc_receptor?: string;
  fecha?: string;
  monto?: number;
  monto_sat?: number;
  monto_odoo?: number;
  odoo_ref?: string;
  partner?: string;
  invoice_ref?: string;
  bank_ref?: string;
  app_ref?: string;
  descripcion?: string;
  type?: string;
  reconciliation_type?: string;
  period?: string;
  matched?: number;
  unmatched?: number;
  discrepancies?: number;
  created_at?: string;
  status?: string;
}

export interface SatOdooResult {
  matched: ReconciliationRecord[];
  in_sat_not_odoo: ReconciliationRecord[];
  in_odoo_not_sat: ReconciliationRecord[];
  amount_differences: ReconciliationRecord[];
  last_run?: string;
}

export interface SatAppResult {
  matched: ReconciliationRecord[];
  in_sat_only: ReconciliationRecord[];
  in_app_only: ReconciliationRecord[];
  last_run?: string;
}

export interface BancoAppResult {
  matched: ReconciliationRecord[];
  in_banco_only: ReconciliationRecord[];
  in_app_only: ReconciliationRecord[];
  last_run?: string;
}

export interface ConfirmDialogState {
  open: boolean;
  title: string;
  description: string;
  variant?: "default" | "destructive";
  onConfirm: () => void;
}

/* ---------- Period helpers ---------- */

export function getPeriodDates(preset: string): ReconciliationPeriod {
  const now = new Date();
  const end = now.toISOString().split("T")[0];

  switch (preset) {
    case "current_month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { period_start: start.toISOString().split("T")[0], period_end: end };
    }
    case "previous_month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const endPrev = new Date(now.getFullYear(), now.getMonth(), 0);
      return {
        period_start: start.toISOString().split("T")[0],
        period_end: endPrev.toISOString().split("T")[0],
      };
    }
    case "quarter": {
      const start = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      return { period_start: start.toISOString().split("T")[0], period_end: end };
    }
    case "semester": {
      const start = new Date(now.getFullYear(), now.getMonth() - 6, 1);
      return { period_start: start.toISOString().split("T")[0], period_end: end };
    }
    default:
      return { period_start: end, period_end: end };
  }
}

/* ---------- Processing steps ---------- */

export const SAT_ODOO_STEPS = [
  "Descargando del SAT...",
  "Leyendo de Odoo...",
  "Comparando registros...",
  "Generando reporte...",
];

export const SAT_APP_STEPS = [
  "Descargando del SAT...",
  "Leyendo facturas de la App...",
  "Comparando registros...",
  "Generando reporte...",
];

export const BANCO_APP_STEPS = [
  "Obteniendo movimientos bancarios...",
  "Leyendo pagos de la App...",
  "Comparando registros...",
  "Generando reporte...",
];
