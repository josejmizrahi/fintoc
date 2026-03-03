"""
Payana-Fintoc: Plataforma fintech integral.
Punto de entrada principal de la aplicación FastAPI.

Módulos:
- Dashboard ejecutivo
- Cuentas por Pagar (AP) con aprobaciones
- Cuentas por Cobrar (AR) con links de pago
- Gestión de Gastos
- Tesorería y Cash Management
- Presupuestos
- Conciliación Bancaria y SAT
- CFDI / SAT (validación, parseo XML, EFOS)
- Portal de Proveedores
- Notificaciones multi-canal
- Reportes y Analítica
- Multi-empresa
- Webhooks Fintoc (SPEI en tiempo real)
"""

import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import init_db

# ── Logging ──
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(name)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger(__name__)

# ── App ──
settings = get_settings()

app = FastAPI(
    title="Payana-Fintoc",
    description=(
        "Plataforma fintech integral para gestión de pagos, cobros, tesorería "
        "y cumplimiento fiscal en México. Integración con Fintoc (SPEI), Odoo ERP y SAT."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── CORS ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Startup ──
@app.on_event("startup")
def on_startup():
    logger.info("Inicializando base de datos...")
    init_db()
    logger.info("Payana-Fintoc v1.0.0 iniciado")


# ── Health check ──
@app.get("/health", tags=["Sistema"])
def health():
    return {"status": "ok", "version": "1.0.0", "app": "Payana-Fintoc"}


# ── Registrar routers ──
from app.api.webhooks import router as webhooks_router
from app.api.payments import router as payments_router
from app.api.collections import router as collections_router
from app.api.invoices import router as invoices_router
from app.api.vendors import router as vendors_router
from app.api.customers import router as customers_router
from app.api.expenses import router as expenses_router
from app.api.approvals import router as approvals_router
from app.api.treasury import router as treasury_router
from app.api.budgets import router as budgets_router
from app.api.reconciliation import router as reconciliation_router
from app.api.sat import router as sat_router
from app.api.reports import router as reports_router
from app.api.notifications import router as notifications_router
from app.api.dashboard import router as dashboard_router
from app.api.dashboard import vendor_portal, companies_router

app.include_router(dashboard_router, prefix="/api")
app.include_router(webhooks_router, prefix="/api")
app.include_router(payments_router, prefix="/api")
app.include_router(collections_router, prefix="/api")
app.include_router(invoices_router, prefix="/api")
app.include_router(vendors_router, prefix="/api")
app.include_router(customers_router, prefix="/api")
app.include_router(expenses_router, prefix="/api")
app.include_router(approvals_router, prefix="/api")
app.include_router(treasury_router, prefix="/api")
app.include_router(budgets_router, prefix="/api")
app.include_router(reconciliation_router, prefix="/api")
app.include_router(sat_router, prefix="/api")
app.include_router(reports_router, prefix="/api")
app.include_router(notifications_router, prefix="/api")
app.include_router(vendor_portal, prefix="/api")
app.include_router(companies_router, prefix="/api")

# ── Legacy webhook endpoint (backward compatible) ──
from app.api.webhooks import fintoc_webhook

app.post(settings.webhook_path)(fintoc_webhook)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=settings.app_port,
        reload=settings.debug,
    )
