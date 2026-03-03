"""
Base de datos local (SQLite/PostgreSQL) para estado de la plataforma.
Almacena: aprobaciones, presupuestos, auditoría, gastos, conciliaciones, notificaciones.
"""

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
)
from sqlalchemy.orm import DeclarativeBase, Session, relationship, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    pass


# ── Enums ──

import enum


class PaymentStatus(str, enum.Enum):
    DRAFT = "draft"
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    REJECTED = "rejected"
    SCHEDULED = "scheduled"
    PROCESSING = "processing"
    SENT = "sent"
    CONFIRMED = "confirmed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ApprovalStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    ESCALATED = "escalated"


class ExpenseStatus(str, enum.Enum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    APPROVED = "approved"
    REJECTED = "rejected"
    PAID = "paid"


class ReconciliationStatus(str, enum.Enum):
    PENDING = "pending"
    MATCHED = "matched"
    PARTIAL = "partial"
    UNMATCHED = "unmatched"
    MANUAL = "manual"


class NotificationType(str, enum.Enum):
    PAYMENT_RECEIVED = "payment_received"
    PAYMENT_SENT = "payment_sent"
    PAYMENT_FAILED = "payment_failed"
    APPROVAL_REQUIRED = "approval_required"
    APPROVAL_GRANTED = "approval_granted"
    APPROVAL_REJECTED = "approval_rejected"
    INVOICE_OVERDUE = "invoice_overdue"
    SAT_VALIDATION_FAILED = "sat_validation_failed"
    BUDGET_EXCEEDED = "budget_exceeded"
    RECONCILIATION_DISCREPANCY = "reconciliation_discrepancy"
    EXPENSE_SUBMITTED = "expense_submitted"
    CFDI_TIMBRADO = "cfdi_timbrado"
    CLABE_VERIFIED = "clabe_verified"


# ── Tables ──


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    name = Column(String(255), nullable=False)
    role = Column(String(30), default="admin")  # admin, manager, accountant, viewer
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=True)
    is_active = Column(Boolean, default=True)
    last_login = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    company = relationship("Company", back_populates="users")


class Company(Base):
    __tablename__ = "companies"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    rfc = Column(String(13), nullable=False, unique=True)
    odoo_company_id = Column(Integer, nullable=True)
    fintoc_account_id = Column(String(100), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    users = relationship("User", back_populates="company")
    payments = relationship("Payment", back_populates="company")
    budgets = relationship("Budget", back_populates="company")


class Payment(Base):
    __tablename__ = "payments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=True)
    direction = Column(String(10), nullable=False)  # inbound / outbound
    status = Column(String(30), default=PaymentStatus.DRAFT.value)
    amount = Column(Float, nullable=False)
    currency = Column(String(3), default="MXN")
    clabe_origin = Column(String(18), nullable=True)
    clabe_destination = Column(String(18), nullable=True)
    reference_id = Column(String(255), nullable=True)
    comment = Column(Text, nullable=True)
    fintoc_transfer_id = Column(String(100), nullable=True)
    fintoc_tracking_key = Column(String(100), nullable=True)
    idempotency_key = Column(String(100), nullable=True, unique=True)
    odoo_invoice_id = Column(Integer, nullable=True)
    odoo_payment_id = Column(Integer, nullable=True)
    odoo_partner_id = Column(Integer, nullable=True)
    partner_name = Column(String(255), nullable=True)
    partner_rfc = Column(String(13), nullable=True)
    cfdi_uuid = Column(String(50), nullable=True)
    sat_status = Column(String(30), nullable=True)
    scheduled_date = Column(DateTime, nullable=True)
    executed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    company = relationship("Company", back_populates="payments")
    approvals = relationship("ApprovalRequest", back_populates="payment")
    audit_entries = relationship("AuditLog", back_populates="payment")


class ApprovalRule(Base):
    __tablename__ = "approval_rules"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=True)
    min_amount = Column(Float, default=0)
    max_amount = Column(Float, nullable=True)
    required_approvers = Column(Integer, default=1)
    approver_emails = Column(Text, nullable=True)  # JSON list
    auto_approve_below = Column(Float, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class ApprovalRequest(Base):
    __tablename__ = "approval_requests"

    id = Column(Integer, primary_key=True, autoincrement=True)
    payment_id = Column(Integer, ForeignKey("payments.id"), nullable=False)
    rule_id = Column(Integer, ForeignKey("approval_rules.id"), nullable=True)
    status = Column(String(20), default=ApprovalStatus.PENDING.value)
    level = Column(Integer, default=1)
    approver_email = Column(String(255), nullable=True)
    approved_by = Column(String(255), nullable=True)
    comment = Column(Text, nullable=True)
    decided_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    payment = relationship("Payment", back_populates="approvals")


class Expense(Base):
    __tablename__ = "expenses"

    id = Column(Integer, primary_key=True, autoincrement=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=True)
    employee_name = Column(String(255), nullable=False)
    employee_email = Column(String(255), nullable=True)
    category = Column(String(100), nullable=True)
    description = Column(Text, nullable=True)
    amount = Column(Float, nullable=False)
    currency = Column(String(3), default="MXN")
    status = Column(String(20), default=ExpenseStatus.DRAFT.value)
    cfdi_uuid = Column(String(50), nullable=True)
    cfdi_xml = Column(Text, nullable=True)
    sat_validated = Column(Boolean, default=False)
    odoo_expense_id = Column(Integer, nullable=True)
    receipt_url = Column(String(500), nullable=True)
    submitted_at = Column(DateTime, nullable=True)
    approved_at = Column(DateTime, nullable=True)
    paid_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class Budget(Base):
    __tablename__ = "budgets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=True)
    name = Column(String(255), nullable=False)
    category = Column(String(100), nullable=True)
    period_start = Column(DateTime, nullable=False)
    period_end = Column(DateTime, nullable=False)
    amount_budgeted = Column(Float, nullable=False)
    amount_spent = Column(Float, default=0)
    amount_committed = Column(Float, default=0)
    alert_threshold_pct = Column(Float, default=80.0)
    is_active = Column(Boolean, default=True)
    odoo_analytic_account_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    company = relationship("Company", back_populates="budgets")


class Reconciliation(Base):
    __tablename__ = "reconciliations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=True)
    payment_id = Column(Integer, ForeignKey("payments.id"), nullable=True)
    bank_transaction_id = Column(String(100), nullable=True)
    fintoc_transfer_id = Column(String(100), nullable=True)
    odoo_payment_id = Column(Integer, nullable=True)
    amount_bank = Column(Float, nullable=True)
    amount_odoo = Column(Float, nullable=True)
    amount_difference = Column(Float, default=0)
    status = Column(String(20), default=ReconciliationStatus.PENDING.value)
    matched_at = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class CfdiDocument(Base):
    __tablename__ = "cfdi_documents"

    id = Column(Integer, primary_key=True, autoincrement=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=True)
    uuid = Column(String(50), unique=True, nullable=False)
    tipo_comprobante = Column(String(5), nullable=True)  # I, E, P, N, T
    rfc_emisor = Column(String(13), nullable=True)
    nombre_emisor = Column(String(300), nullable=True)
    rfc_receptor = Column(String(13), nullable=True)
    nombre_receptor = Column(String(300), nullable=True)
    total = Column(Float, nullable=True)
    subtotal = Column(Float, nullable=True)
    moneda = Column(String(3), default="MXN")
    forma_pago = Column(String(5), nullable=True)
    metodo_pago = Column(String(5), nullable=True)  # PUE / PPD
    uso_cfdi = Column(String(10), nullable=True)
    fecha_emision = Column(DateTime, nullable=True)
    fecha_timbrado = Column(DateTime, nullable=True)
    sello_sat = Column(Text, nullable=True)
    sello_cfdi = Column(Text, nullable=True)
    no_certificado_sat = Column(String(20), nullable=True)
    no_certificado_emisor = Column(String(20), nullable=True)
    sat_status = Column(String(30), nullable=True)
    sat_last_check = Column(DateTime, nullable=True)
    is_cancelable = Column(String(50), nullable=True)
    cancellation_status = Column(String(50), nullable=True)
    efos_status = Column(String(100), nullable=True)
    xml_content = Column(Text, nullable=True)
    odoo_move_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, autoincrement=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=True)
    notification_type = Column(String(50), nullable=False)
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=True)
    recipient_email = Column(String(255), nullable=True)
    channel = Column(String(20), default="internal")  # internal, email, slack
    is_read = Column(Boolean, default=False)
    sent_at = Column(DateTime, nullable=True)
    related_payment_id = Column(Integer, ForeignKey("payments.id"), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=True)
    payment_id = Column(Integer, ForeignKey("payments.id"), nullable=True)
    action = Column(String(100), nullable=False)
    entity_type = Column(String(50), nullable=True)
    entity_id = Column(Integer, nullable=True)
    user_email = Column(String(255), nullable=True)
    details = Column(Text, nullable=True)  # JSON
    ip_address = Column(String(45), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    payment = relationship("Payment", back_populates="audit_entries")


class ScheduledPayment(Base):
    __tablename__ = "scheduled_payments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    payment_id = Column(Integer, ForeignKey("payments.id"), nullable=False)
    scheduled_date = Column(DateTime, nullable=False)
    recurrence = Column(String(20), nullable=True)  # once, weekly, biweekly, monthly
    next_execution = Column(DateTime, nullable=True)
    max_executions = Column(Integer, nullable=True)
    executions_done = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class VendorPortalToken(Base):
    __tablename__ = "vendor_portal_tokens"

    id = Column(Integer, primary_key=True, autoincrement=True)
    odoo_partner_id = Column(Integer, nullable=False)
    token = Column(String(255), unique=True, nullable=False)
    email = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True)
    last_access = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


# ── Engine & Session ──

_engine = None
_SessionLocal = None


def get_engine():
    global _engine
    if _engine is None:
        settings = get_settings()
        _engine = create_engine(
            settings.database_url,
            echo=settings.debug,
            connect_args={"check_same_thread": False}
            if "sqlite" in settings.database_url
            else {},
        )
    return _engine


def get_session_factory():
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(bind=get_engine(), autoflush=False, autocommit=False)
    return _SessionLocal


def get_db():
    SessionLocal = get_session_factory()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    engine = get_engine()
    Base.metadata.create_all(bind=engine)
