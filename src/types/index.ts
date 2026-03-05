export interface Tenant {
  id: string;
  name: string;
  rfc: string;
  plan: "starter" | "pro" | "enterprise";
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "manager" | "accountant" | "viewer";
  tenantId: string;
  avatar?: string;
}

export interface OdooConfig {
  url: string;
  database: string;
  username: string;
  password: string;
  connected: boolean;
}

export interface FintocConfig {
  secretKey: string;
  publicKey: string;
  webhookSecret: string;
  accountId: string;
  linkToken: string;
  connected: boolean;
}

export interface SATConfig {
  rfcEmisor: string;
  keyPassword: string;
  pac: string;
  certFileName?: string;
  keyFileName?: string;
  connected: boolean;
}

export interface DashboardData {
  total_balance: number;
  accounts_receivable: number;
  accounts_payable: number;
  pending_invoices_count: number;
  pending_bills_count: number;
  overdue_invoices: number;
  pending_approvals: number;
  unread_notifications: number;
  budget_alerts: number;
  sat_issues: number;
  net_position: number;
  recent_payments: Payment[];
  overdue_invoice_list: Invoice[];
}

export interface Invoice {
  id: number;
  name: string;
  type?: string;
  partner_name?: string;
  partner?: string;
  partner_rfc?: string;
  amount_total?: number;
  amount_residual?: number;
  amount_tax?: number;
  date_invoice?: string;
  date_due?: string;
  status?: string;
  payment_state?: string; // not_paid, in_payment, paid, partial, reversed
  cfdi_uuid?: string;
  odoo_cfdi_uuid?: string; // UUID from Odoo l10n_mx_edi
  sat_status?: string;
  sat_validated?: boolean;
  payment_policy?: "PUE" | "PPD";
  tipo_comprobante?: string;
  metodo_pago?: string;
  forma_pago?: string;
  moneda?: string;
  tipo_cambio?: number;
  uso_cfdi?: string;
  odoo_usage?: string; // Uso CFDI from Odoo
  odoo_payment_method?: string; // Forma de pago from Odoo
  emisor_nombre?: string;
  receptor_nombre?: string;
  emisor_regimen?: string;
  receptor_regimen?: string;
  es_cancelable?: string;
  estatus_cancelacion?: string;
  efos_status?: string;
  xml_storage_path?: string;
  sat_last_check?: string;
  descuento?: number;
  lugar_expedicion?: string;
  currency?: string;
  move_type?: string; // out_invoice, in_invoice, out_refund, in_refund
  invoice_line_count?: number;
  fintoc_institution_id?: string;
  odoo_id?: number;
  source?: string;
}

export interface Vendor {
  id: number;
  name: string;
  rfc?: string;
  email?: string;
  phone?: string;
  clabe?: string;
  clabe_verified?: boolean;
  clabe_holder_name?: string;
  bank_name?: string;
  regimen_fiscal?: string;
  supplier_rank?: number;
  payment_term?: string;
  rfc_validated?: boolean;
  rfc_validated_at?: string;
  efos_status?: string;
  efos_checked_at?: string;
  odoo_id?: number;
  source?: string;
}

export interface Customer {
  id: number;
  name: string;
  rfc?: string;
  email?: string;
  phone?: string;
  clabe?: string;
  fintoc_account_number_id?: string;
  fintoc_clabe?: string;
  regimen_fiscal?: string;
  customer_rank?: number;
  payment_term?: string;
  rfc_validated?: boolean;
  rfc_validated_at?: string;
  odoo_id?: number;
  source?: string;
}

export interface CfdiDocument {
  id: number;
  company_id: number;
  uuid: string;
  invoice_id?: number;
  tipo_comprobante?: string;
  rfc_emisor?: string;
  nombre_emisor?: string;
  rfc_receptor?: string;
  nombre_receptor?: string;
  total?: number;
  subtotal?: number;
  moneda?: string;
  tipo_cambio?: number;
  forma_pago?: string;
  metodo_pago?: string;
  uso_cfdi?: string;
  lugar_expedicion?: string;
  descuento?: number;
  emisor_regimen?: string;
  receptor_regimen?: string;
  sat_status?: string;
  efos_status?: string;
  is_cancelable?: string;
  cancellation_status?: string;
  fecha_emision?: string;
  fecha_timbrado?: string;
  sat_last_check?: string;
  conceptos?: unknown[];
  impuestos_trasladados?: number;
  impuestos_retenidos?: number;
  complemento_pago?: unknown;
  complemento_nomina?: unknown;
  xml_storage_path?: string;
  created_at?: string;
  updated_at?: string;
}

export interface SatDownloadRequest {
  id: number;
  company_id: number;
  request_id?: string;
  request_type: "emitidos" | "recibidos";
  solicitud_type: "CFDI" | "Metadata";
  fecha_inicio: string;
  fecha_fin: string;
  rfc_emisor?: string;
  rfc_receptor?: string;
  tipo_comprobante?: string;
  estado_comprobante?: string;
  status: string;
  num_cfdis?: number;
  num_packages?: number;
  packages_downloaded?: number;
  error_message?: string;
  sat_message?: string;
  created_at?: string;
  completed_at?: string;
}

export interface SatCancellationRequest {
  id: number;
  company_id: number;
  cfdi_uuid: string;
  invoice_id?: number;
  motivo: string;
  uuid_sustitucion?: string;
  status: string;
  requires_acceptance?: boolean;
  acceptance_deadline?: string;
  error_message?: string;
  requested_by?: string;
  created_at?: string;
  resolved_at?: string;
}

export interface BankMovement {
  id: number;
  company_id: number;
  fintoc_id?: string;
  amount: number;
  currency: string;
  description?: string;
  post_date?: string;
  type: "credit" | "debit";
  reference_id?: string;
  sender_account?: string;
  counterpart_name?: string;
  counterpart_account?: string;
  fintoc_account_number_id?: string;
  created_at?: string;
}

export interface Expense {
  id: number;
  employee_name: string;
  category?: string;
  description?: string;
  amount: number;
  currency: string;
  status: string;
  cfdi_uuid?: string;
  sat_validated: boolean;
  product_category?: string;
  payment_mode?: string; // own_account, company_account
  sheet_id?: number;
  expense_reference?: string;
  odoo_id?: number;
  source?: string;
  created_at?: string;
}

export interface Budget {
  id: number;
  name: string;
  category?: string;
  period_start: string;
  period_end: string;
  amount_budgeted: number;
  amount_spent: number;
  amount_committed: number;
  available: number;
  utilization_pct: number;
  is_over_budget: boolean;
  is_active: boolean;
}

export interface ApprovalRequest {
  approval_id: number;
  payment_id: number;
  level: number;
  approver_email?: string;
  payment_amount: number;
  payment_reference?: string;
  payment_partner?: string;
  created_at?: string;
}

export interface Notification {
  id: number;
  type: string;
  title: string;
  message?: string;
  channel: string;
  is_read: boolean;
  created_at?: string;
}

export interface TreasurySnapshot {
  date: string;
  total_balance: number;
  accounts_receivable: number;
  accounts_payable: number;
  inflows_today: number;
  outflows_today: number;
  inflows_week: number;
  outflows_week: number;
  inflows_month: number;
  outflows_month: number;
  net_position: number;
}

export interface CashFlowForecast {
  date: string;
  expected_inflows: number;
  expected_outflows: number;
  net_flow: number;
  projected_balance: number;
}

export interface ReconciliationEntry {
  odoo_payment: string;
  amount_odoo: number;
  amount_fintoc?: number;
  difference: number;
  status: string;
  cfdi_uuid?: string;
  sat_status?: string;
}

export interface OdooBankStatement {
  id: number;
  company_id: number;
  odoo_statement_line_id?: number;
  bank_movement_id?: number;
  payment_id?: number;
  journal_id?: number;
  partner_id?: number;
  date: string;
  payment_ref?: string;
  amount: number;
  currency: string;
  status: string; // pending, pushed, matched, error
  odoo_match_status?: string; // auto_matched, manual_matched, unmatched
  error_message?: string;
  pushed_at?: string;
  matched_at?: string;
  created_at?: string;
}

export interface OdooPurchaseOrder {
  id: number;
  company_id: number;
  odoo_id: number;
  name: string;
  partner_id?: number;
  partner_name?: string;
  partner_rfc?: string;
  vendor_id?: number;
  state?: string; // draft, sent, purchase, done, cancel
  amount_total?: number;
  amount_tax?: number;
  currency?: string;
  date_order?: string;
  date_planned?: string;
  invoice_status?: string; // no, to_invoice, invoiced
  invoice_count?: number;
  receipt_status?: string;
  notes?: string;
  source?: string;
  created_at?: string;
  updated_at?: string;
}

export interface OdooIdCache {
  company_id: number;
  cache_key: string;
  odoo_id: number;
  display_name?: string;
  extra_data?: Record<string, unknown>;
  fetched_at?: string;
}

export interface Payment {
  id: number;
  direction: "inbound" | "outbound";
  status: string;
  amount: number;
  currency: string;
  clabe_destination?: string;
  reference_id?: string;
  partner_name?: string;
  partner_rfc?: string;
  fintoc_transfer_id?: string;
  fintoc_payment_intent_id?: string;
  cfdi_uuid?: string;
  sat_status?: string;
  executed_at?: string;
  created_at?: string;
  odoo_id?: number;
  odoo_payment_id?: number;
  odoo_state?: string;
  reconciled_invoice_ids?: number[];
  complemento_emitido?: boolean;
  complemento_uuid?: string;
  jws_signed?: boolean;
  bank_movement_id?: number;
  source?: string;
}
