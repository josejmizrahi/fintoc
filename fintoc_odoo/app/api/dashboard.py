"""
API del Dashboard principal y Portal de Proveedores.
"""

import secrets
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Query
from typing import Optional

router = APIRouter(tags=["Dashboard"])


# ══════════════════════════════════════════════════════════════
# DASHBOARD PRINCIPAL
# ══════════════════════════════════════════════════════════════


@router.get("/dashboard", tags=["Dashboard"])
def get_dashboard(company_id: Optional[int] = None):
    """Dashboard ejecutivo con métricas clave."""
    from app.services.fintoc_service import get_fintoc_service
    from app.services.odoo_service import get_odoo_service
    from app.services.notification_service import NotificationService
    from app.services.payment_service import PaymentService
    from app.services.sat_service import get_sat_service
    from app.services.approval_service import ApprovalService
    from app.database import Payment, PaymentStatus, CfdiDocument, Budget, get_session_factory

    fintoc = get_fintoc_service()
    odoo = get_odoo_service()
    sat = get_sat_service()
    notif_svc = NotificationService()
    approval_svc = ApprovalService()

    # Balance
    balance = fintoc.get_account_balance()

    # AR / AP
    pending_invoices = odoo.get_pending_invoices()
    pending_bills = odoo.get_pending_bills()
    overdue = odoo.get_overdue_invoices()

    ar = sum(inv.get("amount_residual", 0) for inv in pending_invoices)
    ap = sum(bill.get("amount_residual", 0) for bill in pending_bills)

    # Aprobaciones pendientes
    pending_approvals = approval_svc.get_pending_approvals()

    # Notificaciones
    unread = notif_svc.get_unread_count(company_id=company_id)

    # Pagos recientes
    payment_svc = PaymentService(fintoc, odoo, sat)
    recent = payment_svc.list_payments(limit=10)

    # Presupuestos con alerta
    SessionLocal = get_session_factory()
    db = SessionLocal()
    try:
        budgets = db.query(Budget).filter_by(is_active=True).all()
        budget_alerts = sum(
            1 for b in budgets
            if b.amount_budgeted > 0 and (b.amount_spent / b.amount_budgeted * 100) >= b.alert_threshold_pct
        )

        # Problemas SAT
        sat_docs = db.query(CfdiDocument).filter(
            CfdiDocument.sat_status.notin_(["Vigente", ""])
        ).count()
    finally:
        db.close()

    return {
        "total_balance": balance.get("balance", 0),
        "accounts_receivable": ar,
        "accounts_payable": ap,
        "pending_invoices_count": len(pending_invoices),
        "pending_bills_count": len(pending_bills),
        "overdue_invoices": len(overdue),
        "pending_approvals": len(pending_approvals),
        "unread_notifications": unread,
        "budget_alerts": budget_alerts,
        "sat_issues": sat_docs,
        "net_position": balance.get("balance", 0) + ar - ap,
        "recent_payments": recent[:5],
        "overdue_invoice_list": [
            {
                "id": inv["id"],
                "name": inv.get("name"),
                "partner": inv.get("partner_id", [0, ""])[1] if isinstance(inv.get("partner_id"), (list, tuple)) else "",
                "amount": inv.get("amount_residual", 0),
                "due_date": inv.get("invoice_date_due"),
            }
            for inv in overdue[:10]
        ],
    }


# ══════════════════════════════════════════════════════════════
# PORTAL DE PROVEEDORES
# ══════════════════════════════════════════════════════════════

vendor_portal = APIRouter(prefix="/vendor-portal", tags=["Portal Proveedores"])


@vendor_portal.post("/token")
def create_portal_token(partner_id: int, email: Optional[str] = None):
    """Genera un token de acceso para el portal de proveedores."""
    from app.database import VendorPortalToken, get_session_factory
    SessionLocal = get_session_factory()
    db = SessionLocal()
    try:
        token = secrets.token_urlsafe(32)
        vpt = VendorPortalToken(
            odoo_partner_id=partner_id,
            token=token,
            email=email,
        )
        db.add(vpt)
        db.commit()
        return {"token": token, "partner_id": partner_id}
    finally:
        db.close()


@vendor_portal.get("/dashboard")
def vendor_dashboard(token: str):
    """Dashboard del proveedor (acceso con token)."""
    from app.database import VendorPortalToken, get_session_factory
    from app.services.odoo_service import get_odoo_service
    from app.services.payment_service import PaymentService
    from app.services.fintoc_service import get_fintoc_service
    from app.services.sat_service import get_sat_service

    SessionLocal = get_session_factory()
    db = SessionLocal()
    try:
        vpt = db.query(VendorPortalToken).filter_by(token=token, is_active=True).first()
        if not vpt:
            raise HTTPException(status_code=401, detail="Token inválido")

        vpt.last_access = datetime.now(timezone.utc)
        db.commit()

        odoo = get_odoo_service()
        partner_id = vpt.odoo_partner_id
        vendor = odoo.get_vendor(partner_id)
        if not vendor:
            raise HTTPException(status_code=404, detail="Proveedor no encontrado")

        bills = odoo.get_pending_bills(partner_id=partner_id)
        # Pagos recientes del proveedor
        fintoc = get_fintoc_service()
        sat = get_sat_service()
        payment_svc = PaymentService(fintoc, odoo, sat)
        payments = payment_svc.list_payments(direction="outbound")
        vendor_payments = [p for p in payments if p.get("odoo_partner_id") == partner_id][:20]

        total_pending = sum(b.get("amount_residual", 0) for b in bills)
        total_paid = sum(p.get("amount", 0) for p in vendor_payments)

        return {
            "vendor_name": vendor.get("name"),
            "vendor_rfc": vendor.get("vat"),
            "pending_bills": [
                {
                    "name": b.get("name"),
                    "amount_total": b.get("amount_total"),
                    "amount_residual": b.get("amount_residual"),
                    "due_date": b.get("invoice_date_due"),
                }
                for b in bills
            ],
            "recent_payments": vendor_payments[:10],
            "total_pending": total_pending,
            "total_paid_recent": total_paid,
        }
    finally:
        db.close()


# ══════════════════════════════════════════════════════════════
# MULTI-EMPRESA
# ══════════════════════════════════════════════════════════════

companies_router = APIRouter(prefix="/companies", tags=["Multi-empresa"])


@companies_router.get("/")
def list_companies():
    """Lista empresas configuradas."""
    from app.database import Company, get_session_factory
    SessionLocal = get_session_factory()
    db = SessionLocal()
    try:
        companies = db.query(Company).filter_by(is_active=True).all()
        return [
            {"id": c.id, "name": c.name, "rfc": c.rfc, "odoo_company_id": c.odoo_company_id}
            for c in companies
        ]
    finally:
        db.close()


@companies_router.post("/")
def create_company(name: str, rfc: str, odoo_company_id: Optional[int] = None, fintoc_account_id: Optional[str] = None):
    """Registra una nueva empresa."""
    from app.database import Company, get_session_factory
    SessionLocal = get_session_factory()
    db = SessionLocal()
    try:
        company = Company(
            name=name, rfc=rfc,
            odoo_company_id=odoo_company_id,
            fintoc_account_id=fintoc_account_id,
        )
        db.add(company)
        db.commit()
        db.refresh(company)
        return {"id": company.id, "name": company.name}
    finally:
        db.close()


@companies_router.get("/odoo")
def list_odoo_companies():
    """Lista empresas desde Odoo."""
    from app.services.odoo_service import get_odoo_service
    return get_odoo_service().get_companies()
