-- ══════════════════════════════════════════════════════════
-- Migration 009: SAT Complete Web Services Support
-- Adds columns for CFDI 4.0 full parsing, EFOS tracking,
-- RFC validation, cancellation support, and descarga masiva.
-- Run this in the Supabase SQL Editor AFTER migration 008
-- ══════════════════════════════════════════════════════════

-- ── New columns on invoices ──

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tipo_comprobante TEXT; -- I/E/T/N/P
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS metodo_pago TEXT; -- PUE / PPD
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS forma_pago TEXT; -- 01,02,03,04,99...
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS moneda TEXT DEFAULT 'MXN';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tipo_cambio NUMERIC(15,6) DEFAULT 1;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS uso_cfdi TEXT; -- G01, G03, P01...
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS emisor_nombre TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS receptor_nombre TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS emisor_regimen TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS receptor_regimen TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sat_validated BOOLEAN DEFAULT false;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS es_cancelable TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS estatus_cancelacion TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS efos_status TEXT DEFAULT 'unknown'; -- clean/presumed/definitive/disproved/favorable/unknown
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS xml_storage_path TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sat_last_check TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS descuento NUMERIC(15,2) DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS lugar_expedicion TEXT;

-- ── New columns on vendors ──

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS rfc_validated BOOLEAN DEFAULT false;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS rfc_validated_at TIMESTAMPTZ;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS efos_status TEXT DEFAULT 'unknown';
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS efos_checked_at TIMESTAMPTZ;

-- ── New columns on customers ──

ALTER TABLE customers ADD COLUMN IF NOT EXISTS rfc_validated BOOLEAN DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS rfc_validated_at TIMESTAMPTZ;

-- ── New columns on cfdi_documents ──

ALTER TABLE cfdi_documents ADD COLUMN IF NOT EXISTS invoice_id INTEGER REFERENCES invoices(id);
ALTER TABLE cfdi_documents ADD COLUMN IF NOT EXISTS subtotal NUMERIC(15,2) DEFAULT 0;
ALTER TABLE cfdi_documents ADD COLUMN IF NOT EXISTS moneda TEXT DEFAULT 'MXN';
ALTER TABLE cfdi_documents ADD COLUMN IF NOT EXISTS tipo_cambio NUMERIC(15,6) DEFAULT 1;
ALTER TABLE cfdi_documents ADD COLUMN IF NOT EXISTS forma_pago TEXT;
ALTER TABLE cfdi_documents ADD COLUMN IF NOT EXISTS metodo_pago TEXT;
ALTER TABLE cfdi_documents ADD COLUMN IF NOT EXISTS uso_cfdi TEXT;
ALTER TABLE cfdi_documents ADD COLUMN IF NOT EXISTS lugar_expedicion TEXT;
ALTER TABLE cfdi_documents ADD COLUMN IF NOT EXISTS descuento NUMERIC(15,2) DEFAULT 0;
ALTER TABLE cfdi_documents ADD COLUMN IF NOT EXISTS emisor_regimen TEXT;
ALTER TABLE cfdi_documents ADD COLUMN IF NOT EXISTS receptor_regimen TEXT;
ALTER TABLE cfdi_documents ADD COLUMN IF NOT EXISTS receptor_domicilio_fiscal TEXT;
ALTER TABLE cfdi_documents ADD COLUMN IF NOT EXISTS exportacion TEXT;
ALTER TABLE cfdi_documents ADD COLUMN IF NOT EXISTS sello_sat TEXT;
ALTER TABLE cfdi_documents ADD COLUMN IF NOT EXISTS sello_cfd TEXT;
ALTER TABLE cfdi_documents ADD COLUMN IF NOT EXISTS no_certificado_sat TEXT;
ALTER TABLE cfdi_documents ADD COLUMN IF NOT EXISTS no_certificado_emisor TEXT;
ALTER TABLE cfdi_documents ADD COLUMN IF NOT EXISTS is_cancelable TEXT;
ALTER TABLE cfdi_documents ADD COLUMN IF NOT EXISTS cancellation_status TEXT;
ALTER TABLE cfdi_documents ADD COLUMN IF NOT EXISTS efos_status TEXT DEFAULT 'unknown';
ALTER TABLE cfdi_documents ADD COLUMN IF NOT EXISTS sat_last_check TIMESTAMPTZ;
ALTER TABLE cfdi_documents ADD COLUMN IF NOT EXISTS conceptos JSONB DEFAULT '[]';
ALTER TABLE cfdi_documents ADD COLUMN IF NOT EXISTS impuestos_trasladados NUMERIC(15,2) DEFAULT 0;
ALTER TABLE cfdi_documents ADD COLUMN IF NOT EXISTS impuestos_retenidos NUMERIC(15,2) DEFAULT 0;
ALTER TABLE cfdi_documents ADD COLUMN IF NOT EXISTS complemento_pago JSONB;
ALTER TABLE cfdi_documents ADD COLUMN IF NOT EXISTS complemento_nomina JSONB;
ALTER TABLE cfdi_documents ADD COLUMN IF NOT EXISTS xml_storage_path TEXT;
ALTER TABLE cfdi_documents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_cfdi_documents_invoice ON cfdi_documents(invoice_id);
CREATE INDEX IF NOT EXISTS idx_cfdi_documents_tipo ON cfdi_documents(tipo_comprobante);
CREATE INDEX IF NOT EXISTS idx_cfdi_documents_emisor ON cfdi_documents(rfc_emisor);
CREATE INDEX IF NOT EXISTS idx_cfdi_documents_receptor ON cfdi_documents(rfc_receptor);
CREATE INDEX IF NOT EXISTS idx_cfdi_documents_status ON cfdi_documents(sat_status);
CREATE INDEX IF NOT EXISTS idx_cfdi_documents_efos ON cfdi_documents(efos_status);

-- ── SAT Descarga Masiva tracking ──

CREATE TABLE IF NOT EXISTS sat_download_requests (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  request_id TEXT, -- ID returned by SAT
  request_type TEXT NOT NULL CHECK (request_type IN ('emitidos', 'recibidos')),
  solicitud_type TEXT NOT NULL DEFAULT 'CFDI' CHECK (solicitud_type IN ('CFDI', 'Metadata')),
  fecha_inicio TIMESTAMPTZ NOT NULL,
  fecha_fin TIMESTAMPTZ NOT NULL,
  rfc_emisor TEXT,
  rfc_receptor TEXT,
  tipo_comprobante TEXT, -- I/E/T/N/P or null for all
  estado_comprobante TEXT, -- 0=Cancelado, 1=Vigente
  complemento TEXT, -- Filter by complement type
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'processing', 'ready', 'downloaded', 'error', 'rejected')),
  num_cfdis INTEGER DEFAULT 0,
  num_packages INTEGER DEFAULT 0,
  packages_downloaded INTEGER DEFAULT 0,
  error_message TEXT,
  sat_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE sat_download_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sat_download_requests_tenant ON sat_download_requests;
CREATE POLICY sat_download_requests_tenant ON sat_download_requests
  FOR ALL USING (company_id = auth_company_id());

CREATE INDEX IF NOT EXISTS idx_sat_downloads_company ON sat_download_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_sat_downloads_status ON sat_download_requests(status);

-- ── SAT Cancellation requests tracking ──

CREATE TABLE IF NOT EXISTS sat_cancellation_requests (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  cfdi_uuid TEXT NOT NULL,
  invoice_id INTEGER REFERENCES invoices(id),
  motivo TEXT NOT NULL CHECK (motivo IN ('01', '02', '03', '04')),
  uuid_sustitucion TEXT, -- Required when motivo = '01'
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'accepted', 'rejected', 'expired', 'error')),
  requires_acceptance BOOLEAN DEFAULT false,
  acceptance_deadline TIMESTAMPTZ, -- 72 hours after request
  error_message TEXT,
  requested_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

ALTER TABLE sat_cancellation_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sat_cancellation_requests_tenant ON sat_cancellation_requests;
CREATE POLICY sat_cancellation_requests_tenant ON sat_cancellation_requests
  FOR ALL USING (company_id = auth_company_id());

CREATE INDEX IF NOT EXISTS idx_sat_cancellations_company ON sat_cancellation_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_sat_cancellations_uuid ON sat_cancellation_requests(cfdi_uuid);

-- ── RFC Validation log ──

CREATE TABLE IF NOT EXISTS rfc_validations (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  rfc TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('vendor', 'customer', 'emisor', 'receptor')),
  entity_id INTEGER,
  is_valid BOOLEAN,
  nombre_razon_social TEXT,
  rfc_status TEXT, -- activo, suspendido, cancelado
  validated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE rfc_validations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rfc_validations_tenant ON rfc_validations;
CREATE POLICY rfc_validations_tenant ON rfc_validations
  FOR ALL USING (company_id = auth_company_id());

CREATE INDEX IF NOT EXISTS idx_rfc_validations_rfc ON rfc_validations(rfc);
CREATE INDEX IF NOT EXISTS idx_rfc_validations_company ON rfc_validations(company_id);
