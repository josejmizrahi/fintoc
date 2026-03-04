"""
Servicio de Conciliación Bancaria.

Funcionalidades:
- Conciliación automática Fintoc vs Odoo
- Conciliación SAT vs complementos de pago
- Matching inteligente de transacciones
- Detección de discrepancias
- Reportes de conciliación
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from app.database import (
    Payment,
    PaymentStatus,
    Reconciliation,
    ReconciliationStatus,
    get_session_factory,
)

logger = logging.getLogger(__name__)


class ReconciliationService:
    """Servicio de conciliación bancaria y fiscal."""

    def __init__(self, fintoc_service, odoo_service, sat_service):
        self.fintoc = fintoc_service
        self.odoo = odoo_service
        self.sat = sat_service

    def reconcile_fintoc_odoo(
        self, days: int = 7, auto_match: bool = True, company_id: int | None = None
    ) -> dict:
        """
        Concilia pagos registrados en Odoo vs transferencias en Fintoc.
        Detecta: pagos sin complemento, CFDI cancelados, montos discrepantes.
        """
        odoo_payments = self.odoo.get_payments_fintoc(days=days)
        fintoc_transfers = self.fintoc.list_transfers(limit=200)

        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            entries = []
            matched = 0
            unmatched = 0
            partial = 0
            total_discrepancy = 0

            # Indexar transfers de Fintoc por tracking_key
            fintoc_by_key = {}
            for t in fintoc_transfers:
                key = t.get("tracking_key")
                if key:
                    fintoc_by_key[key] = t

            for op in odoo_payments:
                pid = op["id"]
                name = op.get("name", "")
                amount_odoo = op.get("amount", 0)
                ref = op.get("ref", "")
                uuid_cfdi = (op.get("l10n_mx_edi_cfdi_uuid") or "").strip()
                sat_status = op.get("l10n_mx_edi_sat_status") or "none"

                # Intentar match
                fintoc_match = None
                if auto_match and ref:
                    fintoc_match = fintoc_by_key.get(ref)

                amount_fintoc = fintoc_match.get("amount", 0) if fintoc_match else None
                difference = abs(amount_odoo - amount_fintoc) if amount_fintoc is not None else amount_odoo

                # Refrescar estado SAT
                try:
                    new_status = self.odoo.update_sat_status(pid, model="account.payment")
                    if new_status:
                        sat_status = new_status
                except Exception:
                    pass

                # Determinar estado
                sin_complemento = not uuid_cfdi
                cancelado = sat_status in ("cancelled", "canceled")
                no_vigente = sat_status not in ("valid", "vigente", "none") and not sin_complemento

                if fintoc_match and difference < 0.01 and not sin_complemento and not cancelado:
                    status = ReconciliationStatus.MATCHED.value
                    matched += 1
                elif fintoc_match and difference >= 0.01:
                    status = ReconciliationStatus.PARTIAL.value
                    partial += 1
                    total_discrepancy += difference
                else:
                    status = ReconciliationStatus.UNMATCHED.value
                    unmatched += 1
                    total_discrepancy += difference

                recon = Reconciliation(
                    company_id=company_id,
                    odoo_payment_id=pid,
                    fintoc_transfer_id=fintoc_match.get("transfer_id") if fintoc_match else None,
                    amount_odoo=amount_odoo,
                    amount_bank=amount_fintoc,
                    amount_difference=difference,
                    status=status,
                    matched_at=datetime.now(timezone.utc) if status == ReconciliationStatus.MATCHED.value else None,
                    notes=f"CFDI: {uuid_cfdi or 'N/A'} | SAT: {sat_status} | Complemento: {'Sí' if uuid_cfdi else 'No'}",
                )
                db.add(recon)
                entries.append({
                    "odoo_payment": name,
                    "amount_odoo": amount_odoo,
                    "amount_fintoc": amount_fintoc,
                    "difference": difference,
                    "status": status,
                    "cfdi_uuid": uuid_cfdi,
                    "sat_status": sat_status,
                    "sin_complemento": sin_complemento,
                    "cancelado": cancelado,
                })

            db.commit()

            return {
                "period_days": days,
                "total_transactions": len(odoo_payments),
                "matched": matched,
                "unmatched": unmatched,
                "partial": partial,
                "total_discrepancy": total_discrepancy,
                "entries": entries,
            }
        finally:
            db.close()

    def reconcile_sat(self, days: int = 7, company_id: int | None = None) -> dict:
        """
        Conciliación SAT: verifica que pagos Fintoc tengan complemento timbrado y vigente.
        """
        payments = self.odoo.get_payments_fintoc(days=days)
        if not payments:
            return {"total": 0, "entries": []}

        entries = []
        issues = 0

        for p in payments:
            pid = p["id"]
            uuid_cfdi = (p.get("l10n_mx_edi_cfdi_uuid") or "").strip()
            sat_status = p.get("l10n_mx_edi_sat_status") or "none"

            try:
                new_status = self.odoo.update_sat_status(pid, model="account.payment")
                if new_status:
                    sat_status = new_status
            except Exception:
                pass

            sin_complemento = not uuid_cfdi
            cancelado = sat_status in ("cancelled", "canceled")
            no_vigente = sat_status not in ("valid", "vigente") and not sin_complemento
            has_issue = sin_complemento or cancelado or no_vigente

            if has_issue:
                issues += 1

            entries.append({
                "payment_id": pid,
                "payment_name": p.get("name"),
                "date": p.get("date"),
                "amount": p.get("amount"),
                "cfdi_uuid": uuid_cfdi or "N/A",
                "sat_status": sat_status,
                "sin_complemento": sin_complemento,
                "cancelado": cancelado,
                "has_issue": has_issue,
            })

        return {
            "period_days": days,
            "total": len(payments),
            "issues": issues,
            "ok": len(payments) - issues,
            "entries": entries,
        }

    def get_reconciliation_history(
        self, company_id: int | None = None, limit: int = 100
    ) -> list[dict]:
        """Lista historial de conciliaciones."""
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            query = db.query(Reconciliation)
            if company_id:
                query = query.filter_by(company_id=company_id)
            recons = query.order_by(Reconciliation.created_at.desc()).limit(limit).all()
            return [
                {
                    "id": r.id,
                    "odoo_payment_id": r.odoo_payment_id,
                    "fintoc_transfer_id": r.fintoc_transfer_id,
                    "amount_odoo": r.amount_odoo,
                    "amount_bank": r.amount_bank,
                    "difference": r.amount_difference,
                    "status": r.status,
                    "notes": r.notes,
                    "created_at": str(r.created_at) if r.created_at else None,
                }
                for r in recons
            ]
        finally:
            db.close()
