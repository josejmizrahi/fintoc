"""
API de Reportes y Analítica.
"""

from fastapi import APIRouter, Query
from fastapi.responses import PlainTextResponse
from typing import Optional

router = APIRouter(prefix="/reports", tags=["Reportes"])


def _get_service():
    from app.services.odoo_service import get_odoo_service
    from app.services.fintoc_service import get_fintoc_service
    from app.services.sat_service import get_sat_service
    from app.services.reporting_service import ReportingService
    return ReportingService(get_odoo_service(), get_fintoc_service(), get_sat_service())


@router.get("/cash-flow")
def cash_flow(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    company_id: Optional[int] = None,
    format: str = Query(default="json", pattern="^(json|csv)$"),
):
    """Reporte de flujo de efectivo."""
    svc = _get_service()
    data = svc.cash_flow_report(date_from=date_from, date_to=date_to, company_id=company_id)
    if format == "csv":
        entries = data.get("inflows", []) + data.get("outflows", [])
        return PlainTextResponse(svc.export_to_csv(entries), media_type="text/csv")
    return data


@router.get("/aging/{report_type}")
def aging(report_type: str):
    """Reporte de antigüedad de saldos (receivable o payable)."""
    return _get_service().aging_report(report_type)


@router.get("/sat-compliance")
def sat_compliance(days: int = Query(default=30, le=365), company_id: Optional[int] = None):
    """Reporte de cumplimiento SAT."""
    return _get_service().sat_compliance_report(days=days, company_id=company_id)


@router.get("/budget-vs-actual")
def budget_vs_actual(company_id: Optional[int] = None):
    """Reporte presupuesto vs ejecución."""
    return _get_service().budget_vs_actual_report(company_id=company_id)


@router.get("/vendor-summary")
def vendor_summary(company_id: Optional[int] = None):
    """Resumen de pagos por proveedor."""
    return _get_service().vendor_summary_report(company_id=company_id)


@router.get("/expenses")
def expense_report(
    company_id: Optional[int] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    """Reporte de gastos."""
    return _get_service().expense_report(company_id=company_id, date_from=date_from, date_to=date_to)
