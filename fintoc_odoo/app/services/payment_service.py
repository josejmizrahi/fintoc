"""
Servicio de Cuentas por Pagar (Accounts Payable).
Orquesta: validación SAT → aprobación → programación → ejecución SPEI → registro Odoo.

Funcionalidades:
- Pago individual y masivo a proveedores
- Validación SAT previa al pago
- Flujos de aprobación multinivel
- Programación de pagos (fecha futura, recurrentes)
- Notificaciones automáticas a proveedores
- Integración completa con Odoo y Fintoc
"""

import json
import logging
import uuid as uuid_lib
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.database import (
    ApprovalRequest,
    ApprovalRule,
    AuditLog,
    Payment,
    PaymentStatus,
    ScheduledPayment,
    get_session_factory,
)

logger = logging.getLogger(__name__)


class PaymentService:
    """Servicio de pagos: AP completo con aprobaciones y SAT."""

    def __init__(self, fintoc_service, odoo_service, sat_service):
        self.fintoc = fintoc_service
        self.odoo = odoo_service
        self.sat = sat_service

    # ── Pago individual a proveedor ──

    def pay_vendor_bill(
        self, bill_id: int, skip_sat: bool = False, company_id: int | None = None
    ) -> dict:
        """
        Flujo completo: validar CFDI → obtener CLABE → verificar aprobación → enviar SPEI.
        """
        cfdi = self.odoo.get_vendor_bill_cfdi(bill_id)
        if not cfdi:
            return {"ok": False, "error": f"No se encontró factura de proveedor ID {bill_id} o sin datos CFDI"}

        name = cfdi.get("name", "")
        amount = cfdi.get("amount_residual") or cfdi.get("amount_total")
        if not amount or amount <= 0:
            return {"ok": False, "error": f"Factura {name} sin monto pendiente"}

        partner_id = cfdi.get("partner_id")
        if not partner_id:
            return {"ok": False, "error": "Factura sin partner_id"}

        # Validar contra SAT
        sat_result = None
        if not skip_sat:
            uuid_cfdi = cfdi.get("uuid")
            if not uuid_cfdi:
                return {"ok": False, "error": f"Factura {name} sin UUID CFDI"}
            rfc_emisor = (cfdi.get("rfc_emisor") or "").strip()
            rfc_receptor = (cfdi.get("rfc_receptor") or "").strip()
            total = cfdi.get("amount_total")
            if not all([rfc_emisor, rfc_receptor, total]):
                return {"ok": False, "error": "Datos fiscales incompletos para validar en SAT"}
            if not self.sat.es_cfdi_valido(rfc_emisor, rfc_receptor, total, uuid_cfdi):
                sat_result = self.sat.validar_cfdi(rfc_emisor, rfc_receptor, total, uuid_cfdi)
                return {"ok": False, "error": f"CFDI no válido ante SAT: {sat_result}", "sat_validation": sat_result}
            sat_result = self.sat.validar_cfdi(rfc_emisor, rfc_receptor, total, uuid_cfdi)

        # Obtener CLABE del proveedor
        clabe = self.odoo.get_vendor_clabe(partner_id)
        if not clabe:
            return {"ok": False, "error": f"Proveedor (ID={partner_id}) sin CLABE en Odoo"}

        # Crear registro en DB local
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            payment = Payment(
                company_id=company_id,
                direction="outbound",
                status=PaymentStatus.PROCESSING.value,
                amount=float(amount),
                clabe_destination=clabe,
                reference_id=name,
                comment=f"Pago | {name}",
                odoo_invoice_id=bill_id,
                odoo_partner_id=partner_id,
                cfdi_uuid=cfdi.get("uuid"),
                idempotency_key=str(uuid_lib.uuid4()),
            )
            db.add(payment)
            db.commit()
            db.refresh(payment)

            # Verificar si necesita aprobación
            needs_approval = self._check_approval_needed(db, float(amount), company_id)
            if needs_approval:
                payment.status = PaymentStatus.PENDING_APPROVAL.value
                self._create_approval_request(db, payment)
                db.commit()
                return {
                    "ok": True,
                    "status": "pending_approval",
                    "payment_id": payment.id,
                    "bill_name": name,
                    "amount": amount,
                }

            # Enviar pago vía Fintoc
            result = self.fintoc.send_transfer(
                clabe_destino=clabe,
                amount_mxn=float(amount),
                comment=f"Pago | {name}",
                reference_id=name,
                idempotency_key=payment.idempotency_key,
            )

            payment.fintoc_transfer_id = result.get("transfer_id")
            payment.fintoc_tracking_key = result.get("tracking_key")
            payment.status = PaymentStatus.SENT.value
            payment.executed_at = datetime.now(timezone.utc)

            # Audit log
            audit = AuditLog(
                company_id=company_id,
                payment_id=payment.id,
                action="payment_sent",
                entity_type="payment",
                entity_id=payment.id,
                details=json.dumps({"bill_id": bill_id, "amount": amount, "clabe": clabe}),
            )
            db.add(audit)
            db.commit()

            return {
                "ok": True,
                "status": "sent",
                "payment_id": payment.id,
                "bill_name": name,
                "amount": amount,
                "transfer_id": result.get("transfer_id"),
                "tracking_key": result.get("tracking_key"),
                "sat_validation": sat_result,
            }

        except Exception as e:
            db.rollback()
            logger.error(f"Error en pay_vendor_bill: {e}")
            return {"ok": False, "error": str(e)}
        finally:
            db.close()

    # ── Pago masivo ──

    def batch_pay(
        self,
        payments_data: list[dict],
        validate_sat: bool = True,
        company_id: int | None = None,
    ) -> dict:
        """
        Pagos masivos con validación SAT opcional.
        Cada item: {clabe, amount_mxn, reference_id, comment}
        """
        results = []
        total_ok = 0
        total_fail = 0
        total_pending = 0

        for item in payments_data:
            ref = item.get("reference_id", "")
            clabe = item.get("clabe", "")
            amount = float(item.get("amount_mxn", 0))

            # Validar SAT si hay factura en Odoo
            if validate_sat and ref:
                bill = self.odoo.get_bill_by_name(ref)
                if bill:
                    cfdi = self.odoo.get_vendor_bill_cfdi(bill["id"])
                    if cfdi and cfdi.get("uuid"):
                        rfc_e = (cfdi.get("rfc_emisor") or "").strip()
                        rfc_r = (cfdi.get("rfc_receptor") or "").strip()
                        total = cfdi.get("amount_total")
                        if rfc_e and rfc_r and total:
                            if not self.sat.es_cfdi_valido(rfc_e, rfc_r, total, cfdi["uuid"]):
                                results.append({
                                    "reference_id": ref, "status": "skipped_sat",
                                    "error": "CFDI no válido ante SAT",
                                })
                                total_fail += 1
                                continue

            SessionLocal = get_session_factory()
            db = SessionLocal()
            try:
                payment = Payment(
                    company_id=company_id,
                    direction="outbound",
                    amount=amount,
                    clabe_destination=clabe,
                    reference_id=ref,
                    comment=item.get("comment", "Pago"),
                    idempotency_key=str(uuid_lib.uuid4()),
                )

                # Aprobación
                needs_approval = self._check_approval_needed(db, amount, company_id)
                if needs_approval:
                    payment.status = PaymentStatus.PENDING_APPROVAL.value
                    db.add(payment)
                    db.commit()
                    self._create_approval_request(db, payment)
                    db.commit()
                    results.append({"reference_id": ref, "status": "pending_approval", "payment_id": payment.id})
                    total_pending += 1
                    continue

                payment.status = PaymentStatus.PROCESSING.value
                db.add(payment)
                db.commit()
                db.refresh(payment)

                result = self.fintoc.send_transfer(
                    clabe_destino=clabe,
                    amount_mxn=amount,
                    comment=item.get("comment", "Pago"),
                    reference_id=ref,
                    idempotency_key=payment.idempotency_key,
                )
                payment.fintoc_transfer_id = result.get("transfer_id")
                payment.fintoc_tracking_key = result.get("tracking_key")
                payment.status = PaymentStatus.SENT.value
                payment.executed_at = datetime.now(timezone.utc)
                db.commit()

                results.append({
                    "reference_id": ref,
                    "status": "sent",
                    "transfer_id": result.get("transfer_id"),
                    "payment_id": payment.id,
                })
                total_ok += 1

            except Exception as e:
                db.rollback()
                results.append({"reference_id": ref, "status": "error", "error": str(e)})
                total_fail += 1
            finally:
                db.close()

        return {
            "total_payments": len(payments_data),
            "total_amount": sum(float(p.get("amount_mxn", 0)) for p in payments_data),
            "successful": total_ok,
            "failed": total_fail,
            "pending_approval": total_pending,
            "results": results,
        }

    # ── Ejecución de pago aprobado ──

    def execute_approved_payment(self, payment_id: int) -> dict:
        """Ejecuta un pago que ya fue aprobado."""
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            payment = db.query(Payment).filter_by(id=payment_id).first()
            if not payment:
                return {"ok": False, "error": "Pago no encontrado"}
            if payment.status != PaymentStatus.APPROVED.value:
                return {"ok": False, "error": f"Estado del pago: {payment.status} (esperado: approved)"}
            if not payment.clabe_destination:
                return {"ok": False, "error": "Sin CLABE destino"}

            result = self.fintoc.send_transfer(
                clabe_destino=payment.clabe_destination,
                amount_mxn=payment.amount,
                comment=payment.comment or "",
                reference_id=payment.reference_id or "",
                idempotency_key=payment.idempotency_key or str(uuid_lib.uuid4()),
            )
            payment.fintoc_transfer_id = result.get("transfer_id")
            payment.fintoc_tracking_key = result.get("tracking_key")
            payment.status = PaymentStatus.SENT.value
            payment.executed_at = datetime.now(timezone.utc)
            db.commit()

            return {
                "ok": True,
                "payment_id": payment_id,
                "transfer_id": result.get("transfer_id"),
                "tracking_key": result.get("tracking_key"),
            }
        except Exception as e:
            db.rollback()
            return {"ok": False, "error": str(e)}
        finally:
            db.close()

    # ── Pagos programados ──

    def schedule_payment(
        self, payment_id: int, scheduled_date: datetime,
        recurrence: str | None = None, max_executions: int | None = None,
    ) -> dict:
        """Programa un pago para ejecución futura."""
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            payment = db.query(Payment).filter_by(id=payment_id).first()
            if not payment:
                return {"ok": False, "error": "Pago no encontrado"}

            payment.status = PaymentStatus.SCHEDULED.value
            payment.scheduled_date = scheduled_date

            sched = ScheduledPayment(
                payment_id=payment_id,
                scheduled_date=scheduled_date,
                recurrence=recurrence,
                next_execution=scheduled_date,
                max_executions=max_executions,
            )
            db.add(sched)
            db.commit()
            return {"ok": True, "payment_id": payment_id, "scheduled_date": str(scheduled_date)}
        finally:
            db.close()

    def get_scheduled_payments(self) -> list[dict]:
        """Lista pagos programados pendientes."""
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            scheds = db.query(ScheduledPayment).filter_by(is_active=True).all()
            results = []
            for s in scheds:
                p = db.query(Payment).filter_by(id=s.payment_id).first()
                results.append({
                    "schedule_id": s.id,
                    "payment_id": s.payment_id,
                    "amount": p.amount if p else 0,
                    "reference_id": p.reference_id if p else "",
                    "scheduled_date": str(s.scheduled_date),
                    "recurrence": s.recurrence,
                    "next_execution": str(s.next_execution) if s.next_execution else None,
                    "executions_done": s.executions_done,
                })
            return results
        finally:
            db.close()

    # ── Listar pagos ──

    def list_payments(
        self, direction: str | None = None, status: str | None = None,
        company_id: int | None = None, limit: int = 100,
    ) -> list[dict]:
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            query = db.query(Payment)
            if direction:
                query = query.filter_by(direction=direction)
            if status:
                query = query.filter_by(status=status)
            if company_id:
                query = query.filter_by(company_id=company_id)
            payments = query.order_by(Payment.created_at.desc()).limit(limit).all()
            return [
                {
                    "id": p.id,
                    "direction": p.direction,
                    "status": p.status,
                    "amount": p.amount,
                    "currency": p.currency,
                    "clabe_destination": p.clabe_destination,
                    "reference_id": p.reference_id,
                    "partner_name": p.partner_name,
                    "fintoc_transfer_id": p.fintoc_transfer_id,
                    "cfdi_uuid": p.cfdi_uuid,
                    "sat_status": p.sat_status,
                    "executed_at": str(p.executed_at) if p.executed_at else None,
                    "created_at": str(p.created_at) if p.created_at else None,
                }
                for p in payments
            ]
        finally:
            db.close()

    def get_payment(self, payment_id: int) -> dict | None:
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            p = db.query(Payment).filter_by(id=payment_id).first()
            if not p:
                return None
            return {
                "id": p.id,
                "direction": p.direction,
                "status": p.status,
                "amount": p.amount,
                "currency": p.currency,
                "clabe_destination": p.clabe_destination,
                "reference_id": p.reference_id,
                "fintoc_transfer_id": p.fintoc_transfer_id,
                "fintoc_tracking_key": p.fintoc_tracking_key,
                "odoo_invoice_id": p.odoo_invoice_id,
                "partner_name": p.partner_name,
                "cfdi_uuid": p.cfdi_uuid,
                "sat_status": p.sat_status,
                "scheduled_date": str(p.scheduled_date) if p.scheduled_date else None,
                "executed_at": str(p.executed_at) if p.executed_at else None,
                "created_at": str(p.created_at) if p.created_at else None,
            }
        finally:
            db.close()

    # ── Aprobaciones (internal helpers) ──

    def _check_approval_needed(self, db: Session, amount: float, company_id: int | None) -> bool:
        rules = db.query(ApprovalRule).filter_by(is_active=True)
        if company_id:
            rules = rules.filter(
                (ApprovalRule.company_id == company_id) | (ApprovalRule.company_id.is_(None))
            )
        for rule in rules:
            if rule.auto_approve_below and amount < rule.auto_approve_below:
                continue
            if rule.min_amount <= amount and (rule.max_amount is None or amount <= rule.max_amount):
                return True
        return False

    def _create_approval_request(self, db: Session, payment: Payment):
        rules = db.query(ApprovalRule).filter_by(is_active=True).all()
        for rule in rules:
            if rule.min_amount <= payment.amount and (rule.max_amount is None or payment.amount <= rule.max_amount):
                emails = json.loads(rule.approver_emails) if rule.approver_emails else []
                for i, email in enumerate(emails):
                    approval = ApprovalRequest(
                        payment_id=payment.id,
                        rule_id=rule.id,
                        level=i + 1,
                        approver_email=email,
                    )
                    db.add(approval)
                break
