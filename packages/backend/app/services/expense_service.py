"""
Servicio de Gestión de Gastos (Expense Management).

Funcionalidades:
- Registro de gastos con CFDI (XML)
- Validación SAT automática del comprobante
- Flujo de aprobación de gastos
- Categorización y reporting
- Sincronización con Odoo (hr.expense)
- Reembolsos a empleados vía SPEI
"""

import json
import logging
from datetime import datetime, timezone
from typing import Optional

from app.database import Expense, ExpenseStatus, AuditLog, get_session_factory
from app.utils.cfdi_parser import parse_cfdi_xml

logger = logging.getLogger(__name__)


class ExpenseService:
    """Servicio de gestión de gastos corporativos."""

    def __init__(self, sat_service, odoo_service=None, fintoc_service=None):
        self.sat = sat_service
        self.odoo = odoo_service
        self.fintoc = fintoc_service

    def create_expense(
        self,
        employee_name: str,
        amount: float,
        category: str | None = None,
        description: str | None = None,
        cfdi_xml: str | None = None,
        cfdi_uuid: str | None = None,
        employee_email: str | None = None,
        receipt_url: str | None = None,
        company_id: int | None = None,
    ) -> dict:
        """Crea un nuevo gasto. Si incluye CFDI XML, lo valida contra SAT."""
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            expense = Expense(
                company_id=company_id,
                employee_name=employee_name,
                employee_email=employee_email,
                category=category,
                description=description,
                amount=amount,
                cfdi_uuid=cfdi_uuid,
                cfdi_xml=cfdi_xml,
                receipt_url=receipt_url,
                status=ExpenseStatus.DRAFT.value,
            )

            # Parsear y validar CFDI si se proporciona XML
            if cfdi_xml:
                try:
                    data = parse_cfdi_xml(cfdi_xml)
                    timbre = data.get("timbre", {})
                    uuid = timbre.get("uuid", "")
                    if uuid:
                        expense.cfdi_uuid = uuid
                        # Validar contra SAT
                        rfc_emisor = data.get("emisor", {}).get("rfc", "")
                        rfc_receptor = data.get("receptor", {}).get("rfc", "")
                        total = data.get("total", 0)
                        if rfc_emisor and rfc_receptor and total:
                            is_valid = self.sat.es_cfdi_valido(
                                rfc_emisor, rfc_receptor, total, uuid
                            )
                            expense.sat_validated = is_valid
                            if not is_valid:
                                logger.warning(f"Gasto con CFDI no válido: {uuid}")
                except Exception as e:
                    logger.warning(f"Error parseando CFDI de gasto: {e}")

            db.add(expense)
            db.commit()
            db.refresh(expense)

            return {
                "id": expense.id,
                "status": expense.status,
                "sat_validated": expense.sat_validated,
                "cfdi_uuid": expense.cfdi_uuid,
            }
        finally:
            db.close()

    def submit_expense(self, expense_id: int) -> dict:
        """Envía un gasto para aprobación."""
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            expense = db.query(Expense).filter_by(id=expense_id).first()
            if not expense:
                return {"ok": False, "error": "Gasto no encontrado"}
            if expense.status != ExpenseStatus.DRAFT.value:
                return {"ok": False, "error": f"Estado actual: {expense.status}"}
            expense.status = ExpenseStatus.SUBMITTED.value
            expense.submitted_at = datetime.now(timezone.utc)
            db.commit()
            return {"ok": True, "status": expense.status}
        finally:
            db.close()

    def approve_expense(self, expense_id: int, approver: str | None = None) -> dict:
        """Aprueba un gasto."""
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            expense = db.query(Expense).filter_by(id=expense_id).first()
            if not expense:
                return {"ok": False, "error": "Gasto no encontrado"}
            if expense.status != ExpenseStatus.SUBMITTED.value:
                return {"ok": False, "error": f"Estado actual: {expense.status}"}
            expense.status = ExpenseStatus.APPROVED.value
            expense.approved_at = datetime.now(timezone.utc)
            db.commit()
            return {"ok": True, "status": expense.status}
        finally:
            db.close()

    def reject_expense(self, expense_id: int, reason: str | None = None) -> dict:
        """Rechaza un gasto."""
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            expense = db.query(Expense).filter_by(id=expense_id).first()
            if not expense:
                return {"ok": False, "error": "Gasto no encontrado"}
            expense.status = ExpenseStatus.REJECTED.value
            db.commit()
            return {"ok": True, "status": expense.status}
        finally:
            db.close()

    def pay_expense(self, expense_id: int, clabe_employee: str | None = None) -> dict:
        """Paga un gasto aprobado vía SPEI al empleado."""
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            expense = db.query(Expense).filter_by(id=expense_id).first()
            if not expense:
                return {"ok": False, "error": "Gasto no encontrado"}
            if expense.status != ExpenseStatus.APPROVED.value:
                return {"ok": False, "error": f"Estado actual: {expense.status}"}
            if not clabe_employee:
                return {"ok": False, "error": "CLABE del empleado requerida"}

            if self.fintoc:
                result = self.fintoc.send_transfer(
                    clabe_destino=clabe_employee,
                    amount_mxn=expense.amount,
                    comment=f"Reembolso gasto {expense.id}",
                    reference_id=f"EXP-{expense.id}",
                )
                expense.status = ExpenseStatus.PAID.value
                expense.paid_at = datetime.now(timezone.utc)
                db.commit()
                return {"ok": True, "status": "paid", "transfer": result}

            expense.status = ExpenseStatus.PAID.value
            expense.paid_at = datetime.now(timezone.utc)
            db.commit()
            return {"ok": True, "status": "paid"}
        finally:
            db.close()

    def list_expenses(
        self, status: str | None = None, company_id: int | None = None,
        employee_name: str | None = None, limit: int = 100,
    ) -> list[dict]:
        """Lista gastos con filtros opcionales."""
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            query = db.query(Expense)
            if status:
                query = query.filter_by(status=status)
            if company_id:
                query = query.filter_by(company_id=company_id)
            if employee_name:
                query = query.filter(Expense.employee_name.ilike(f"%{employee_name}%"))
            expenses = query.order_by(Expense.created_at.desc()).limit(limit).all()
            return [
                {
                    "id": e.id,
                    "employee_name": e.employee_name,
                    "category": e.category,
                    "description": e.description,
                    "amount": e.amount,
                    "currency": e.currency,
                    "status": e.status,
                    "cfdi_uuid": e.cfdi_uuid,
                    "sat_validated": e.sat_validated,
                    "created_at": str(e.created_at) if e.created_at else None,
                }
                for e in expenses
            ]
        finally:
            db.close()

    def get_expense_summary(self, company_id: int | None = None) -> dict:
        """Resumen de gastos por categoría y estado."""
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            query = db.query(Expense)
            if company_id:
                query = query.filter_by(company_id=company_id)
            expenses = query.all()

            by_status: dict[str, float] = {}
            by_category: dict[str, float] = {}
            for e in expenses:
                by_status[e.status] = by_status.get(e.status, 0) + e.amount
                cat = e.category or "Sin categoría"
                by_category[cat] = by_category.get(cat, 0) + e.amount

            return {
                "total_expenses": len(expenses),
                "total_amount": sum(e.amount for e in expenses),
                "by_status": by_status,
                "by_category": by_category,
            }
        finally:
            db.close()
