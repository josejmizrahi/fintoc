"""
Conciliación periódica: pagos registrados en Odoo vía Fintoc vs Complementos de Pago timbrados y SAT.

Para cada pago del diario Fintoc en los últimos N días:
  - Verifica que tenga Complemento de Pago (UUID)
  - Refresca estado SAT (l10n_mx_edi_update_sat_status)
  - Reporta discrepancias: pagos sin complemento, complementos cancelados o no vigentes

Uso:
  python reconcile_sat.py [--days 7] [--output reporte_sat.csv]
"""
import argparse
import csv
from datetime import datetime

from odoo_client import OdooClient

odoo = OdooClient()


def run_reconcile(days: int = 7, output_path: str = "reporte_sat_reconcile.csv") -> list[dict]:
    payments = odoo.get_payments_fintoc(days=days)
    if not payments:
        print(f"No hay pagos Fintoc en los últimos {days} días.")
        return []

    print(f"Revisando {len(payments)} pagos (últimos {days} días)...")
    rows = []
    for p in payments:
        pid = p["id"]
        name = p.get("name", "")
        amount = p.get("amount", 0)
        date = p.get("date", "")
        uuid_cfdi = (p.get("l10n_mx_edi_cfdi_uuid") or "").strip()
        sat_status = p.get("l10n_mx_edi_sat_status") or "none"
        reconciled = p.get("reconciled_invoice_ids") or []

        # Refrescar estado SAT
        try:
            new_status = odoo.update_sat_status(pid, model="account.payment")
            if new_status:
                sat_status = new_status
        except Exception:
            pass

        # Clasificar
        sin_complemento = not uuid_cfdi
        cancelado = sat_status in ("cancelled", "canceled")
        no_vigente = sat_status not in ("valid", "vigente") and not sin_complemento
        discrepancia = sin_complemento or cancelado or no_vigente

        row = {
            "payment_id": pid,
            "payment_name": name,
            "date": date,
            "amount": amount,
            "uuid_complemento": uuid_cfdi or "",
            "sat_status": sat_status,
            "sin_complemento": sin_complemento,
            "cancelado": cancelado,
            "discrepancia": discrepancia,
            "invoice_ids": ",".join(str(x) for x in reconciled) if isinstance(reconciled, list) else str(reconciled),
        }
        rows.append(row)

        if discrepancia:
            print(f"  [!!] {name} | {date} | UUID: {uuid_cfdi or 'N/A'} | SAT: {sat_status}")

    # Escribir CSV
    if rows:
        fieldnames = list(rows[0].keys())
        with open(output_path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fieldnames)
            w.writeheader()
            w.writerows(rows)
        print(f"Reporte guardado en {output_path}")

    return rows


def main():
    parser = argparse.ArgumentParser(description="Conciliación SAT vs pagos Fintoc en Odoo")
    parser.add_argument("--days", type=int, default=7, help="Días hacia atrás para revisar")
    parser.add_argument("--output", default="reporte_sat_reconcile.csv", help="Archivo CSV de salida")
    args = parser.parse_args()

    run_reconcile(days=args.days, output_path=args.output)


if __name__ == "__main__":
    main()
