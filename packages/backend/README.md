# Payana-Fintoc

Plataforma fintech integral para gestión de pagos, cobros, tesorería y cumplimiento fiscal en México.
Integración completa con **Fintoc** (SPEI), **Odoo** ERP y **SAT**.

## Funcionalidades

| Módulo | Descripción |
|--------|-------------|
| **Cuentas por Pagar (AP)** | Pago individual y masivo a proveedores, validación SAT previa, flujos de aprobación multinivel, programación de pagos |
| **Cuentas por Cobrar (AR)** | CLABEs virtuales por cliente, links de pago Checkout, recordatorios, aging de cartera |
| **Gestión de Gastos** | Registro con CFDI XML, validación SAT automática, aprobación, reembolso SPEI |
| **Tesorería** | Dashboard en tiempo real, balance consolidado, proyección de flujo de efectivo |
| **Presupuestos** | CRUD por categoría/período, alertas por exceso, presupuesto vs ejecución |
| **Conciliación Bancaria** | Fintoc vs Odoo, SAT vs complementos de pago, matching automático |
| **CFDI / SAT** | Parseo XML CFDI 3.3/4.0, validación individual y masiva, detección EFOS, almacenamiento |
| **Portal de Proveedores** | Acceso con token, facturas pendientes, historial de pagos |
| **Notificaciones** | Multi-canal: in-app, email (SMTP), Slack |
| **Reportes** | Flujo de efectivo, aging, cumplimiento SAT, presupuesto vs actual, resumen proveedores |
| **Multi-empresa** | Soporte para múltiples empresas con Odoo |
| **Webhooks Fintoc** | Procesamiento en tiempo real de cobros, pagos, rechazos, verificaciones |
| **Auditoría** | Log completo de acciones, pagos y aprobaciones |

## Arquitectura

```
fintoc_odoo/
├── app/                          # Aplicación principal
│   ├── main.py                   # FastAPI entry point
│   ├── config.py                 # Configuración centralizada
│   ├── database.py               # SQLAlchemy models + DB setup
│   ├── models/
│   │   └── schemas.py            # Pydantic schemas (request/response)
│   ├── services/                 # Lógica de negocio
│   │   ├── fintoc_service.py     # CLABEs, SPEI, Checkout, movimientos
│   │   ├── odoo_service.py       # Clientes, facturas, pagos, CFDI, aging
│   │   ├── sat_service.py        # Validación CFDI, EFOS, bulk, XML
│   │   ├── payment_service.py    # AP: pagos con aprobaciones y SAT
│   │   ├── collection_service.py # AR: cobranza, links, CLABEs
│   │   ├── expense_service.py    # Gastos con CFDI y reembolso
│   │   ├── treasury_service.py   # Tesorería y cash flow
│   │   ├── budget_service.py     # Presupuestos
│   │   ├── reconciliation_service.py  # Conciliación bancaria y SAT
│   │   ├── approval_service.py   # Flujos de aprobación
│   │   ├── notification_service.py    # Notificaciones multi-canal
│   │   └── reporting_service.py  # Reportes y analítica
│   ├── api/                      # Endpoints REST
│   │   ├── webhooks.py           # Fintoc webhooks
│   │   ├── payments.py           # Pagos AP
│   │   ├── collections.py        # Cobranza AR
│   │   ├── invoices.py           # Facturas
│   │   ├── vendors.py            # Proveedores
│   │   ├── customers.py          # Clientes
│   │   ├── expenses.py           # Gastos
│   │   ├── approvals.py          # Aprobaciones
│   │   ├── treasury.py           # Tesorería
│   │   ├── budgets.py            # Presupuestos
│   │   ├── reconciliation.py     # Conciliación
│   │   ├── sat.py                # SAT / CFDI
│   │   ├── reports.py            # Reportes
│   │   ├── notifications.py      # Notificaciones
│   │   └── dashboard.py          # Dashboard + Portal Proveedores + Multi-empresa
│   └── utils/
│       ├── validators.py         # Validación CLABE, RFC, formateo
│       └── cfdi_parser.py        # Parser XML CFDI 3.3/4.0
├── *.py                          # Scripts CLI legacy (compatibles)
├── requirements.txt
└── .env.example
```

## Instalación

### 1. Instalar dependencias

```bash
cd fintoc_odoo
pip install -r requirements.txt
```

### 2. Configurar variables de entorno

```bash
cp .env.example .env
# Editar .env con datos reales
```

### 3. Generar llaves JWS (una sola vez)

```bash
openssl genrsa -out private_key.pem 2048
openssl rsa -in private_key.pem -pubout -out public_key.pem
```

Subir `public_key.pem` en **app.fintoc.com → Settings → JWS Keys**.

### 4. Iniciar la aplicación

```bash
python -m app.main
```

La API estará en `http://localhost:8001`. Documentación interactiva en `/docs`.

### 5. Configurar Webhooks en Fintoc

Registrar en **app.fintoc.com → Webhooks → New Endpoint**:
- **URL:** `https://tu-servidor/fintoc/webhook`
- **Eventos:** `transfer.*`, `account_verification.*`, `checkout_session.*`, `payment_intent.*`

## API Endpoints

### Dashboard
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/dashboard` | Dashboard ejecutivo |
| GET | `/health` | Health check |

### Pagos (AP)
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/payments/` | Lista pagos |
| POST | `/api/payments/vendor` | Pago a proveedor con validación SAT |
| POST | `/api/payments/batch` | Pagos masivos |
| POST | `/api/payments/{id}/execute` | Ejecutar pago aprobado |
| POST | `/api/payments/{id}/schedule` | Programar pago |

### Cobranza (AR)
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/collections/pending` | Facturas pendientes de cobro |
| GET | `/api/collections/overdue` | Facturas vencidas |
| POST | `/api/collections/payment-link` | Generar link de pago |
| POST | `/api/collections/clabes/setup-all` | Crear CLABEs masivamente |

### Gastos
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/expenses/` | Crear gasto (con CFDI) |
| POST | `/api/expenses/{id}/action` | submit/approve/reject/pay |

### Aprobaciones
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/approvals/rules` | Crear regla |
| POST | `/api/approvals/{id}/approve` | Aprobar pago |
| POST | `/api/approvals/{id}/reject` | Rechazar pago |

### Tesorería
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/treasury/snapshot` | Snapshot en tiempo real |
| GET | `/api/treasury/forecast` | Proyección de flujo |

### Presupuestos
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/budgets/` | Crear presupuesto |
| GET | `/api/budgets/vs-actual` | Presupuesto vs ejecución |

### Conciliación
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/reconciliation/fintoc-odoo` | Conciliar Fintoc vs Odoo |
| POST | `/api/reconciliation/sat` | Conciliar SAT |

### SAT / CFDI
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/sat/validate` | Validar CFDI individual |
| POST | `/api/sat/validate/bulk` | Validación masiva |
| POST | `/api/sat/upload-xml` | Subir XML CFDI 3.3/4.0 |

### Reportes
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/reports/cash-flow` | Flujo de efectivo |
| GET | `/api/reports/aging/{type}` | Aging (receivable/payable) |
| GET | `/api/reports/sat-compliance` | Cumplimiento SAT |
| GET | `/api/reports/budget-vs-actual` | Presupuesto vs actual |
| GET | `/api/reports/vendor-summary` | Resumen proveedores |

### Portal Proveedores
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/vendor-portal/token` | Generar token de acceso |
| GET | `/api/vendor-portal/dashboard` | Dashboard del proveedor |

Documentación completa interactiva disponible en `/docs` (Swagger UI) y `/redoc`.

## Configuración en Odoo

1. Crear **Diario contable** "Fintoc SPEI" (tipo: Banco)
2. Configurar PAC en Contabilidad > Configuración > Facturación electrónica MX
3. Facturas de clientes con política **PPD** para Complemento de Pago
4. Registrar CLABEs de proveedores en sus contactos

## Scripts Legacy

```bash
python setup_clabes.py            # Alta inicial de CLABEs
python sync_customers.py          # Sincronizar clientes
python send_payout.py             # Pago individual CLI
python pay_vendor.py              # Pago proveedor con SAT
python batch_payout.py            # Pagos masivos CLI
python reconcile_sat.py           # Conciliación SAT CLI
python test_e2e.py                # Prueba E2E
```

## Stack Tecnológico

| Capa | Tecnología |
|------|------------|
| Framework | FastAPI + Uvicorn |
| Base de datos | SQLAlchemy (SQLite / PostgreSQL) |
| Pagos | Fintoc SDK (SPEI directo) |
| ERP | Odoo 17/18/19 (XML-RPC) |
| Fiscal | SAT ConsultaCFDIService (SOAP/zeep) |
| XML | CFDI 3.3/4.0 parser nativo |
| Validación | Pydantic v2 |
| Notificaciones | SMTP + Slack webhooks |
