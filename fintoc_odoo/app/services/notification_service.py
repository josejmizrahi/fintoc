"""
Servicio de Notificaciones y Alertas.

Funcionalidades:
- Notificaciones internas (in-app)
- Notificaciones por email (SMTP)
- Notificaciones por Slack (webhook)
- Alertas automáticas por eventos de pago
- Gestión de lectura/no lectura
"""

import json
import logging
import smtplib
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

import requests

from app.config import get_settings
from app.database import Notification, NotificationType, get_session_factory

logger = logging.getLogger(__name__)


class NotificationService:
    """Servicio de notificaciones multi-canal."""

    def __init__(self):
        self.settings = get_settings()

    def create_notification(
        self,
        notification_type: str,
        title: str,
        message: str = "",
        recipient_email: str | None = None,
        channel: str = "internal",
        company_id: int | None = None,
        payment_id: int | None = None,
    ) -> dict:
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            notif = Notification(
                company_id=company_id,
                notification_type=notification_type,
                title=title,
                message=message,
                recipient_email=recipient_email,
                channel=channel,
                related_payment_id=payment_id,
            )
            db.add(notif)
            db.commit()
            db.refresh(notif)

            # Enviar según canal
            if channel == "email" and recipient_email:
                self._send_email(recipient_email, title, message)
                notif.sent_at = datetime.now(timezone.utc)
                db.commit()
            elif channel == "slack":
                self._send_slack(title, message)
                notif.sent_at = datetime.now(timezone.utc)
                db.commit()

            return {"id": notif.id, "status": "sent" if notif.sent_at else "created"}
        finally:
            db.close()

    def notify_payment_received(
        self, amount: float, partner_name: str, tracking_key: str,
        company_id: int | None = None, payment_id: int | None = None,
    ):
        self.create_notification(
            notification_type=NotificationType.PAYMENT_RECEIVED.value,
            title=f"Cobro recibido: ${amount:,.2f} MXN de {partner_name}",
            message=f"Se recibió un pago SPEI de ${amount:,.2f} MXN de {partner_name}. Clave rastreo: {tracking_key}",
            channel="internal",
            company_id=company_id,
            payment_id=payment_id,
        )

    def notify_payment_sent(
        self, amount: float, partner_name: str, tracking_key: str,
        company_id: int | None = None, payment_id: int | None = None,
    ):
        self.create_notification(
            notification_type=NotificationType.PAYMENT_SENT.value,
            title=f"Pago enviado: ${amount:,.2f} MXN a {partner_name}",
            message=f"Se envió un pago SPEI de ${amount:,.2f} MXN a {partner_name}. Clave rastreo: {tracking_key}",
            channel="internal",
            company_id=company_id,
            payment_id=payment_id,
        )

    def notify_payment_failed(
        self, amount: float, partner_name: str, reason: str,
        company_id: int | None = None, payment_id: int | None = None,
    ):
        self.create_notification(
            notification_type=NotificationType.PAYMENT_FAILED.value,
            title=f"Pago rechazado: ${amount:,.2f} MXN a {partner_name}",
            message=f"El pago SPEI a {partner_name} fue rechazado. Razón: {reason}",
            channel="internal",
            company_id=company_id,
            payment_id=payment_id,
        )

    def notify_approval_required(
        self, payment_id: int, amount: float, approver_email: str,
        company_id: int | None = None,
    ):
        self.create_notification(
            notification_type=NotificationType.APPROVAL_REQUIRED.value,
            title=f"Aprobación requerida: pago de ${amount:,.2f} MXN",
            message=f"Se requiere tu aprobación para un pago de ${amount:,.2f} MXN. ID: {payment_id}",
            recipient_email=approver_email,
            channel="email",
            company_id=company_id,
            payment_id=payment_id,
        )

    def notify_invoice_overdue(
        self, invoice_name: str, partner_name: str, amount: float, days_overdue: int,
        company_id: int | None = None,
    ):
        self.create_notification(
            notification_type=NotificationType.INVOICE_OVERDUE.value,
            title=f"Factura vencida: {invoice_name} ({days_overdue} días)",
            message=f"La factura {invoice_name} de {partner_name} por ${amount:,.2f} MXN tiene {days_overdue} días vencida.",
            channel="internal",
            company_id=company_id,
        )

    def notify_sat_issue(
        self, cfdi_uuid: str, issue: str, company_id: int | None = None
    ):
        self.create_notification(
            notification_type=NotificationType.SAT_VALIDATION_FAILED.value,
            title=f"Problema SAT: CFDI {cfdi_uuid[:8]}...",
            message=f"Se detectó un problema con el CFDI {cfdi_uuid}: {issue}",
            channel="internal",
            company_id=company_id,
        )

    def get_notifications(
        self, company_id: int | None = None, unread_only: bool = False, limit: int = 50,
    ) -> list[dict]:
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            query = db.query(Notification)
            if company_id:
                query = query.filter_by(company_id=company_id)
            if unread_only:
                query = query.filter_by(is_read=False)
            notifs = query.order_by(Notification.created_at.desc()).limit(limit).all()
            return [
                {
                    "id": n.id,
                    "type": n.notification_type,
                    "title": n.title,
                    "message": n.message,
                    "channel": n.channel,
                    "is_read": n.is_read,
                    "created_at": str(n.created_at) if n.created_at else None,
                }
                for n in notifs
            ]
        finally:
            db.close()

    def mark_as_read(self, notification_id: int) -> dict:
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            notif = db.query(Notification).filter_by(id=notification_id).first()
            if not notif:
                return {"ok": False, "error": "No encontrada"}
            notif.is_read = True
            db.commit()
            return {"ok": True}
        finally:
            db.close()

    def mark_all_read(self, company_id: int | None = None) -> dict:
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            query = db.query(Notification).filter_by(is_read=False)
            if company_id:
                query = query.filter_by(company_id=company_id)
            count = query.update({"is_read": True})
            db.commit()
            return {"ok": True, "marked": count}
        finally:
            db.close()

    def get_unread_count(self, company_id: int | None = None) -> int:
        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            query = db.query(Notification).filter_by(is_read=False)
            if company_id:
                query = query.filter_by(company_id=company_id)
            return query.count()
        finally:
            db.close()

    # ── Email ──

    def _send_email(self, to: str, subject: str, body: str):
        if not self.settings.smtp_host:
            logger.warning("SMTP no configurado, email no enviado")
            return
        try:
            msg = MIMEMultipart()
            msg["From"] = self.settings.notification_email_from or self.settings.smtp_user
            msg["To"] = to
            msg["Subject"] = subject
            msg.attach(MIMEText(body, "html"))
            with smtplib.SMTP(self.settings.smtp_host, self.settings.smtp_port) as server:
                server.starttls()
                server.login(self.settings.smtp_user, self.settings.smtp_password)
                server.send_message(msg)
            logger.info(f"Email enviado a {to}")
        except Exception as e:
            logger.error(f"Error enviando email: {e}")

    # ── Slack ──

    def _send_slack(self, title: str, message: str):
        if not self.settings.slack_webhook_url:
            logger.warning("Slack webhook no configurado")
            return
        try:
            payload = {"text": f"*{title}*\n{message}"}
            requests.post(self.settings.slack_webhook_url, json=payload, timeout=10)
            logger.info("Notificación Slack enviada")
        except Exception as e:
            logger.error(f"Error enviando Slack: {e}")
