"""
Servicio de Flujos de Aprobación.

Funcionalidades:
- Reglas de aprobación configurables por monto
- Aprobación multinivel
- Auto-aprobación por debajo de umbral
- Historial de aprobaciones
- Notificaciones a aprobadores
"""

import json
import logging
from datetime import datetime, timezone
from typing import Optional

from app.database import (
    ApprovalRequest,
    ApprovalRule,
    ApprovalStatus,
    AuditLog,
    Notification,
    NotificationType,
    Payment,
    PaymentStatus,
    get_session_factory,
)

logger = logging.getLogger(__name__)


class ApprovalService:
    """Servicio de flujos de aprobación."""

    # ── Reglas ──

    def create_rule(
        self,
        name: str,
        min_amount: float = 0,
        max_amount: float | None = None,
        required_approvers: int = 1,
        approver_emails: list[str] | None = None,
        auto_approve_below: float = 0,
        company_id: int | None = None,
    ) -> dict:
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            rule = ApprovalRule(
                name=name,
                company_id=company_id,
                min_amount=min_amount,
                max_amount=max_amount,
                required_approvers=required_approvers,
                approver_emails=json.dumps(approver_emails or []),
                auto_approve_below=auto_approve_below,
            )
            db.add(rule)
            db.commit()
            db.refresh(rule)
            return {"id": rule.id, "name": rule.name, "status": "created"}
        finally:
            db.close()

    def update_rule(self, rule_id: int, **kwargs) -> dict:
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            rule = db.query(ApprovalRule).filter_by(id=rule_id).first()
            if not rule:
                return {"ok": False, "error": "Regla no encontrada"}
            for key, value in kwargs.items():
                if key == "approver_emails" and isinstance(value, list):
                    setattr(rule, key, json.dumps(value))
                elif hasattr(rule, key) and value is not None:
                    setattr(rule, key, value)
            db.commit()
            return {"ok": True, "id": rule_id}
        finally:
            db.close()

    def delete_rule(self, rule_id: int) -> dict:
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            rule = db.query(ApprovalRule).filter_by(id=rule_id).first()
            if not rule:
                return {"ok": False, "error": "Regla no encontrada"}
            rule.is_active = False
            db.commit()
            return {"ok": True}
        finally:
            db.close()

    def list_rules(self, company_id: int | None = None) -> list[dict]:
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            query = db.query(ApprovalRule).filter_by(is_active=True)
            if company_id:
                query = query.filter(
                    (ApprovalRule.company_id == company_id) | (ApprovalRule.company_id.is_(None))
                )
            rules = query.all()
            return [
                {
                    "id": r.id,
                    "name": r.name,
                    "min_amount": r.min_amount,
                    "max_amount": r.max_amount,
                    "required_approvers": r.required_approvers,
                    "approver_emails": json.loads(r.approver_emails) if r.approver_emails else [],
                    "auto_approve_below": r.auto_approve_below,
                    "is_active": r.is_active,
                }
                for r in rules
            ]
        finally:
            db.close()

    # ── Aprobaciones ──

    def approve_payment(
        self, payment_id: int, approver_email: str, comment: str | None = None
    ) -> dict:
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            pending = (
                db.query(ApprovalRequest)
                .filter_by(payment_id=payment_id, status=ApprovalStatus.PENDING.value)
                .order_by(ApprovalRequest.level)
                .first()
            )
            if not pending:
                return {"ok": False, "error": "No hay aprobaciones pendientes para este pago"}

            pending.status = ApprovalStatus.APPROVED.value
            pending.approved_by = approver_email
            pending.comment = comment
            pending.decided_at = datetime.now(timezone.utc)

            # Verificar si todas las aprobaciones están completas
            remaining = (
                db.query(ApprovalRequest)
                .filter_by(payment_id=payment_id, status=ApprovalStatus.PENDING.value)
                .count()
            )

            payment = db.query(Payment).filter_by(id=payment_id).first()
            if remaining == 0 and payment:
                payment.status = PaymentStatus.APPROVED.value
                # Audit
                audit = AuditLog(
                    company_id=payment.company_id,
                    payment_id=payment_id,
                    action="payment_approved",
                    user_email=approver_email,
                    details=json.dumps({"comment": comment}),
                )
                db.add(audit)

            db.commit()
            return {
                "ok": True,
                "approval_id": pending.id,
                "remaining_approvals": remaining,
                "payment_status": payment.status if payment else "unknown",
            }
        finally:
            db.close()

    def reject_payment(
        self, payment_id: int, approver_email: str, comment: str | None = None
    ) -> dict:
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            pending = (
                db.query(ApprovalRequest)
                .filter_by(payment_id=payment_id, status=ApprovalStatus.PENDING.value)
                .first()
            )
            if not pending:
                return {"ok": False, "error": "No hay aprobaciones pendientes"}

            # Rechazar todas las pendientes
            all_pending = (
                db.query(ApprovalRequest)
                .filter_by(payment_id=payment_id, status=ApprovalStatus.PENDING.value)
                .all()
            )
            for ap in all_pending:
                ap.status = ApprovalStatus.REJECTED.value
                ap.decided_at = datetime.now(timezone.utc)

            pending.approved_by = approver_email
            pending.comment = comment

            payment = db.query(Payment).filter_by(id=payment_id).first()
            if payment:
                payment.status = PaymentStatus.REJECTED.value

            db.commit()
            return {"ok": True, "payment_status": "rejected"}
        finally:
            db.close()

    def get_pending_approvals(self, approver_email: str | None = None) -> list[dict]:
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            query = db.query(ApprovalRequest).filter_by(status=ApprovalStatus.PENDING.value)
            if approver_email:
                query = query.filter_by(approver_email=approver_email)
            approvals = query.all()
            results = []
            for a in approvals:
                payment = db.query(Payment).filter_by(id=a.payment_id).first()
                results.append({
                    "approval_id": a.id,
                    "payment_id": a.payment_id,
                    "level": a.level,
                    "approver_email": a.approver_email,
                    "payment_amount": payment.amount if payment else 0,
                    "payment_reference": payment.reference_id if payment else "",
                    "payment_partner": payment.partner_name if payment else "",
                    "created_at": str(a.created_at) if a.created_at else None,
                })
            return results
        finally:
            db.close()

    def get_approval_history(self, payment_id: int) -> list[dict]:
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            approvals = (
                db.query(ApprovalRequest)
                .filter_by(payment_id=payment_id)
                .order_by(ApprovalRequest.level)
                .all()
            )
            return [
                {
                    "id": a.id,
                    "level": a.level,
                    "status": a.status,
                    "approver_email": a.approver_email,
                    "approved_by": a.approved_by,
                    "comment": a.comment,
                    "decided_at": str(a.decided_at) if a.decided_at else None,
                }
                for a in approvals
            ]
        finally:
            db.close()
