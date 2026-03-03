"""
Pydantic schemas para todos los módulos de la plataforma.
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


# ── Payments ──


class PaymentCreate(BaseModel):
    direction: str = Field(..., pattern="^(inbound|outbound)$")
    amount: float = Field(..., gt=0)
    currency: str = "MXN"
    clabe_destination: Optional[str] = None
    reference_id: Optional[str] = None
    comment: Optional[str] = None
    odoo_invoice_id: Optional[int] = None
    odoo_partner_id: Optional[int] = None
    partner_name: Optional[str] = None
    scheduled_date: Optional[datetime] = None
    company_id: Optional[int] = None


class PaymentResponse(BaseModel):
    id: int
    direction: str
    status: str
    amount: float
    currency: str
    clabe_destination: Optional[str] = None
    reference_id: Optional[str] = None
    fintoc_transfer_id: Optional[str] = None
    fintoc_tracking_key: Optional[str] = None
    odoo_invoice_id: Optional[int] = None
    odoo_payment_id: Optional[int] = None
    partner_name: Optional[str] = None
    cfdi_uuid: Optional[str] = None
    sat_status: Optional[str] = None
    scheduled_date: Optional[datetime] = None
    executed_at: Optional[datetime] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class BatchPaymentItem(BaseModel):
    clabe: str
    amount_mxn: float = Field(..., gt=0)
    reference_id: str
    comment: Optional[str] = "Pago"


class BatchPaymentRequest(BaseModel):
    payments: list[BatchPaymentItem]
    validate_sat: bool = True
    require_approval: bool = True
    company_id: Optional[int] = None


class BatchPaymentResponse(BaseModel):
    total_payments: int
    total_amount: float
    successful: int
    failed: int
    pending_approval: int
    results: list[dict]


# ── Vendor Payment ──


class VendorPaymentRequest(BaseModel):
    bill_id: int
    skip_sat: bool = False
    company_id: Optional[int] = None


class VendorPaymentResponse(BaseModel):
    ok: bool
    bill_id: Optional[int] = None
    bill_name: Optional[str] = None
    amount: Optional[float] = None
    transfer_id: Optional[str] = None
    tracking_key: Optional[str] = None
    sat_validation: Optional[dict] = None
    error: Optional[str] = None


# ── Invoices ──


class InvoiceResponse(BaseModel):
    id: int
    name: str
    partner_id: int
    partner_name: Optional[str] = None
    amount_total: Optional[float] = None
    amount_residual: Optional[float] = None
    invoice_date_due: Optional[str] = None
    move_type: Optional[str] = None
    cfdi_uuid: Optional[str] = None
    payment_policy: Optional[str] = None
    sat_status: Optional[str] = None


class InvoiceListResponse(BaseModel):
    invoices: list[InvoiceResponse]
    total_count: int
    total_amount: float
    total_residual: float


# ── Collections (Accounts Receivable) ──


class CollectionCreate(BaseModel):
    partner_id: int
    invoice_ids: Optional[list[int]] = None
    send_reminder: bool = False
    generate_payment_link: bool = False
    company_id: Optional[int] = None


class CollectionResponse(BaseModel):
    partner_id: int
    partner_name: str
    clabe: Optional[str] = None
    pending_invoices: list[InvoiceResponse]
    total_pending: float
    payment_link: Optional[str] = None
    reminder_sent: bool = False


# ── Approval Workflows ──


class ApprovalRuleCreate(BaseModel):
    name: str
    min_amount: float = 0
    max_amount: Optional[float] = None
    required_approvers: int = 1
    approver_emails: list[str] = []
    auto_approve_below: float = 0
    company_id: Optional[int] = None


class ApprovalRuleResponse(BaseModel):
    id: int
    name: str
    min_amount: float
    max_amount: Optional[float]
    required_approvers: int
    auto_approve_below: float
    is_active: bool

    class Config:
        from_attributes = True


class ApprovalAction(BaseModel):
    action: str = Field(..., pattern="^(approve|reject)$")
    approver_email: str
    comment: Optional[str] = None


class ApprovalResponse(BaseModel):
    id: int
    payment_id: int
    status: str
    level: int
    approver_email: Optional[str]
    decided_at: Optional[datetime]

    class Config:
        from_attributes = True


# ── Expenses ──


class ExpenseCreate(BaseModel):
    employee_name: str
    employee_email: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    amount: float = Field(..., gt=0)
    currency: str = "MXN"
    cfdi_uuid: Optional[str] = None
    cfdi_xml: Optional[str] = None
    receipt_url: Optional[str] = None
    company_id: Optional[int] = None


class ExpenseResponse(BaseModel):
    id: int
    employee_name: str
    category: Optional[str]
    description: Optional[str]
    amount: float
    currency: str
    status: str
    cfdi_uuid: Optional[str]
    sat_validated: bool
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


class ExpenseAction(BaseModel):
    action: str = Field(..., pattern="^(submit|approve|reject|pay)$")
    approver_email: Optional[str] = None
    comment: Optional[str] = None


# ── Treasury ──


class TreasurySnapshot(BaseModel):
    date: str
    total_balance: float
    accounts: list[dict]
    inflows_today: float
    outflows_today: float
    inflows_week: float
    outflows_week: float
    inflows_month: float
    outflows_month: float
    pending_inbound: float
    pending_outbound: float
    pending_approvals_amount: float
    cash_flow_forecast: list[dict]


class CashFlowForecast(BaseModel):
    period: str
    expected_inflows: float
    expected_outflows: float
    projected_balance: float
    pending_receivables: float
    pending_payables: float


# ── Budgets ──


class BudgetCreate(BaseModel):
    name: str
    category: Optional[str] = None
    period_start: datetime
    period_end: datetime
    amount_budgeted: float = Field(..., gt=0)
    alert_threshold_pct: float = 80.0
    odoo_analytic_account_id: Optional[int] = None
    company_id: Optional[int] = None


class BudgetResponse(BaseModel):
    id: int
    name: str
    category: Optional[str]
    period_start: datetime
    period_end: datetime
    amount_budgeted: float
    amount_spent: float
    amount_committed: float
    available: float
    utilization_pct: float
    alert_threshold_pct: float
    is_over_budget: bool
    is_active: bool

    class Config:
        from_attributes = True


# ── Reconciliation ──


class ReconciliationRequest(BaseModel):
    days: int = 7
    auto_match: bool = True
    company_id: Optional[int] = None


class ReconciliationEntry(BaseModel):
    id: int
    payment_id: Optional[int]
    bank_transaction_id: Optional[str]
    fintoc_transfer_id: Optional[str]
    amount_bank: Optional[float]
    amount_odoo: Optional[float]
    amount_difference: float
    status: str
    notes: Optional[str]

    class Config:
        from_attributes = True


class ReconciliationReport(BaseModel):
    period_days: int
    total_transactions: int
    matched: int
    unmatched: int
    partial: int
    total_discrepancy: float
    entries: list[ReconciliationEntry]


# ── SAT / CFDI ──


class CfdiValidationRequest(BaseModel):
    rfc_emisor: str
    rfc_receptor: str
    total: float
    uuid: str
    sello_ultimos_8: Optional[str] = None


class CfdiValidationResponse(BaseModel):
    uuid: str
    estado: str
    codigo_estatus: str
    es_cancelable: str
    estatus_cancelacion: str
    validacion_efos: str
    is_valid: bool
    has_efos_issue: bool


class CfdiUploadRequest(BaseModel):
    xml_content: str
    company_id: Optional[int] = None


class CfdiDocumentResponse(BaseModel):
    id: int
    uuid: str
    tipo_comprobante: Optional[str]
    rfc_emisor: Optional[str]
    nombre_emisor: Optional[str]
    rfc_receptor: Optional[str]
    nombre_receptor: Optional[str]
    total: Optional[float]
    moneda: str
    metodo_pago: Optional[str]
    sat_status: Optional[str]
    efos_status: Optional[str]
    fecha_emision: Optional[datetime]

    class Config:
        from_attributes = True


class CfdiBulkValidationRequest(BaseModel):
    uuids: Optional[list[str]] = None
    days: Optional[int] = 30
    company_id: Optional[int] = None


class CfdiBulkValidationResponse(BaseModel):
    total: int
    valid: int
    invalid: int
    errors: int
    results: list[CfdiValidationResponse]


# ── Vendor Portal ──


class VendorPortalInvoice(BaseModel):
    invoice_name: str
    amount_total: float
    amount_residual: float
    date_due: Optional[str]
    payment_status: str
    cfdi_uuid: Optional[str]


class VendorPortalPayment(BaseModel):
    payment_name: str
    amount: float
    date: str
    status: str
    tracking_key: Optional[str]


class VendorPortalDashboard(BaseModel):
    vendor_name: str
    vendor_rfc: Optional[str]
    pending_invoices: list[VendorPortalInvoice]
    recent_payments: list[VendorPortalPayment]
    total_pending: float
    total_paid_last_30d: float


# ── Dashboard ──


class DashboardSummary(BaseModel):
    total_balance: float
    accounts_receivable: float
    accounts_payable: float
    cash_flow_net_30d: float
    payments_today: int
    collections_today: int
    pending_approvals: int
    overdue_invoices: int
    sat_issues: int
    budget_alerts: int
    recent_payments: list[PaymentResponse]
    upcoming_payments: list[PaymentResponse]
    overdue_invoice_list: list[InvoiceResponse]


# ── Reports ──


class ReportRequest(BaseModel):
    report_type: str  # cash_flow, aging, sat_compliance, budget_vs_actual, vendor_summary
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    company_id: Optional[int] = None
    format: str = "json"  # json, csv


class CashFlowReport(BaseModel):
    period: str
    inflows: list[dict]
    outflows: list[dict]
    net_flow: float
    opening_balance: float
    closing_balance: float


class AgingReport(BaseModel):
    report_type: str  # receivable / payable
    current: float
    days_1_30: float
    days_31_60: float
    days_61_90: float
    days_over_90: float
    total: float
    details: list[dict]


class SatComplianceReport(BaseModel):
    period: str
    total_cfdis: int
    valid: int
    invalid: int
    cancelled: int
    efos_issues: int
    missing_complement: int
    details: list[dict]


# ── Notifications ──


class NotificationResponse(BaseModel):
    id: int
    notification_type: str
    title: str
    message: Optional[str]
    channel: str
    is_read: bool
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


# ── CLABE Management ──


class ClabeCreate(BaseModel):
    partner_id: int
    partner_name: str


class ClabeResponse(BaseModel):
    clabe: str
    account_number_id: str
    odoo_partner_id: int
    partner_name: str


class ClabeVerifyRequest(BaseModel):
    clabe: str


class ClabeVerifyResponse(BaseModel):
    verification_id: str
    status: str
    holder_name: Optional[str] = None
    holder_rfc: Optional[str] = None


# ── Audit ──


class AuditLogResponse(BaseModel):
    id: int
    action: str
    entity_type: Optional[str]
    entity_id: Optional[int]
    user_email: Optional[str]
    details: Optional[str]
    ip_address: Optional[str]
    created_at: Optional[datetime]

    class Config:
        from_attributes = True
