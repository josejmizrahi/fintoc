/* eslint-disable @typescript-eslint/no-empty-object-type */
/**
 * Supabase Database type definitions.
 * Generated manually from migrations 001–014.
 * All IDs use string type to support both SERIAL and UUID columns.
 * IMPORTANT: Use `type` not `interface` so types satisfy Record<string, unknown>.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type TableDef<Row, Insert = Row, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: {
    foreignKeyName: string;
    columns: string[];
    isOneToOne?: boolean;
    referencedRelation: string;
    referencedColumns: string[];
  }[];
};

type WithOptional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

// ── Row types (all use `type` to satisfy Record<string, unknown>) ──

type CompanyRow = {
  id: string;
  name: string;
  rfc: string;
  is_active: boolean;
  onboarding_completed: boolean;
  address: string | null;
  phone: string | null;
  logo_url: string | null;
  created_at: string;
  updated_at: string | null;
};

type UserRow = {
  id: string;
  auth_uid: string | null;
  email: string;
  password_hash: string;
  name: string;
  role: string;
  company_id: string | null;
  is_active: boolean;
  created_at: string;
};

type UserCompanyRow = {
  id: string;
  user_id: string;
  company_id: string;
  role: string;
  is_active: boolean;
  status: string;
  invited_by: string | null;
  invited_at: string | null;
  accepted_at: string | null;
  created_at: string;
};

type IntegrationRow = {
  id: string;
  company_id: string;
  provider: string;
  is_connected: boolean;
  config: Json | null;
  config_encrypted: string | null;
  syntage_credential_id: string | null;
  syntage_taxpayer_id: string | null;
  last_sync: string | null;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_message: string | null;
  sync_errors: Json | null;
  status: string;
  created_at: string;
  updated_at: string | null;
};

type PaymentRow = {
  id: string;
  company_id: string;
  direction: string;
  status: string;
  amount: number;
  currency: string;
  partner_name: string | null;
  partner_rfc: string | null;
  reference_id: string | null;
  clabe_origin: string | null;
  clabe_destination: string | null;
  comment: string | null;
  scheduled_date: string | null;
  vendor_id: string | null;
  invoice_id: string | null;
  beneficiary_name: string | null;
  beneficiary_clabe: string | null;
  clabe: string | null;
  concept: string | null;
  reference: string | null;
  confirmed_at: string | null;
  fintoc_transfer_id: string | null;
  fintoc_payment_intent_id: string | null;
  fintoc_error: string | null;
  odoo_payment_id: string | null;
  odoo_synced_at: string | null;
  created_by: string | null;
  executed_at: string | null;
  sat_status: string | null;
  payment_state: string | null;
  reconciled_invoice_ids: Json | null;
  odoo_state: string | null;
  created_at: string;
  updated_at: string | null;
};

type InvoiceRow = {
  id: string;
  company_id: string;
  type: string | null;
  partner_name: string | null;
  partner_rfc: string | null;
  amount_total: number;
  amount_residual: number;
  amount_paid: number;
  amount_tax: number;
  date_invoice: string | null;
  date_due: string | null;
  status: string;
  cfdi_uuid: string | null;
  name: string | null;
  source: string | null;
  sat_status: string | null;
  payment_status: string | null;
  payment_state: string | null;
  vendor_id: string | null;
  customer_id: string | null;
  invoice_number: string | null;
  uuid: string | null;
  issuer_rfc: string | null;
  receiver_rfc: string | null;
  invoice_date: string | null;
  due_date: string | null;
  currency: string;
  payment_method: string | null;
  efos_status: string | null;
  cancellable: boolean | null;
  xml_url: string | null;
  odoo_move_id: string | null;
  odoo_cfdi_uuid: string | null;
  odoo_payment_method: string | null;
  odoo_usage: string | null;
  move_type: string | null;
  invoice_line_count: number;
  syntage_invoice_id: string | null;
  validated_at: string | null;
  created_at: string;
  updated_at: string | null;
};

type InvoicePaymentRow = {
  id: string;
  invoice_id: string;
  payment_id: string;
  amount: number;
  created_at: string;
};

type CfdiComplementRow = {
  id: string;
  company_id: string;
  invoice_id: string;
  payment_id: string;
  uuid: string | null;
  amount: number;
  payment_date: string;
  xml_url: string | null;
  created_at: string;
};

type VendorRow = {
  id: string;
  company_id: string;
  name: string;
  rfc: string | null;
  email: string | null;
  clabe: string | null;
  is_active: boolean;
  rfc_validated: boolean;
  clabe_verified: boolean;
  clabe_holder_name: string | null;
  bank_name: string | null;
  efos_status: string | null;
  odoo_id: string | null;
  synced_at: string | null;
  phone: string | null;
  regimen_fiscal: string | null;
  supplier_rank: number;
  payment_term: string | null;
  created_at: string;
  updated_at: string | null;
};

type CustomerRow = {
  id: string;
  company_id: string;
  name: string;
  rfc: string | null;
  email: string | null;
  clabe: string | null;
  is_active: boolean;
  fintoc_clabe: string | null;
  fintoc_account_id: string | null;
  odoo_id: string | null;
  phone: string | null;
  regimen_fiscal: string | null;
  customer_rank: number;
  payment_term: string | null;
  created_at: string;
  updated_at: string | null;
};

type ExpenseRow = {
  id: string;
  company_id: string;
  employee_name: string | null;
  employee_email: string | null;
  category: string | null;
  description: string | null;
  amount: number;
  currency: string;
  status: string;
  xml_url: string | null;
  rejected_reason: string | null;
  approved_by: string | null;
  created_by: string | null;
  cfdi_uuid: string | null;
  sat_validated: boolean;
  product_category: string | null;
  payment_mode: string | null;
  sheet_id: number | null;
  expense_reference: string | null;
  odoo_id: number | null;
  created_at: string;
  updated_at: string | null;
};

type ApprovalRuleRow = {
  id: string;
  company_id: string;
  name: string;
  min_amount: number;
  max_amount: number | null;
  amount_min: number | null;
  amount_max: number | null;
  required_approvers: number;
  approver_emails: string[];
  approvers: string[] | null;
  auto_approve_below: number | null;
  auto_approve: boolean;
  is_active: boolean;
  active: boolean;
  created_at: string;
};

type ApprovalRequestRow = {
  id: string;
  company_id: string;
  payment_id: string | null;
  rule_id: string | null;
  status: string;
  level: number;
  approver_email: string | null;
  amount: number | null;
  partner_name: string | null;
  comment: string | null;
  entity_type: string;
  entity_id: string | null;
  requested_by: string | null;
  resolved_by: string | null;
  rejection_reason: string | null;
  resolved_at: string | null;
  created_at: string;
};

type BudgetRow = {
  id: string;
  company_id: string;
  name: string;
  category: string | null;
  period_start: string | null;
  period_end: string | null;
  amount_budgeted: number;
  amount_spent: number;
  amount_committed: number;
  amount: number | null;
  alert_threshold_pct: number;
  is_active: boolean;
  created_at: string;
};

type NotificationRow = {
  id: string;
  company_id: string;
  user_id: string | null;
  notification_type: string | null;
  event_type: string | null;
  entity_type: string | null;
  entity_id: string | null;
  title: string | null;
  message: string | null;
  channel: string;
  is_read: boolean;
  read: boolean;
  created_at: string;
};

type BankAccountRow = {
  id: string;
  company_id: string;
  fintoc_account_id: string;
  clabe: string;
  bank_name: string | null;
  account_holder: string | null;
  balance: number | null;
  currency: string;
  last_synced: string | null;
  created_at: string;
};

type BankMovementRow = {
  id: string;
  company_id: string;
  fintoc_id: string | null;
  fintoc_movement_id: string | null;
  account_id: string | null;
  amount: number;
  currency: string;
  description: string | null;
  post_date: string | null;
  date: string | null;
  type: string | null;
  reference_id: string | null;
  sender_account: string | null;
  counterpart_name: string | null;
  counterpart_account: string | null;
  balance_after: number | null;
  reconciled: boolean;
  reconciled_payment_id: string | null;
  created_at: string;
};

type SyntageExtractionRow = {
  id: string;
  company_id: string;
  syntage_extraction_id: string;
  extractor: string;
  status: string;
  records_found: number | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
};

type AuditLogRow = {
  id: string;
  company_id: string;
  user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  changes: Json | null;
  metadata: Json | null;
  user_email: string | null;
  description: string | null;
  ip_address: string | null;
  created_at: string;
};

type SyncHistoryRow = {
  id: string;
  company_id: string;
  provider: string;
  status: string;
  records_synced: number | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
};

type WebhookLogRow = {
  id: string;
  company_id: string | null;
  provider: string;
  event_type: string;
  payload: Json;
  processed: boolean;
  error: string | null;
  created_at: string;
};

type ReconciliationRow = {
  id: string;
  company_id: string;
  type: string | null;
  status: string;
  total_transactions: number;
  matched: number;
  unmatched: number;
  amount_matched: number;
  created_at: string;
};

type CfdiDocumentRow = {
  id: string;
  company_id: string;
  uuid: string | null;
  tipo_comprobante: string | null;
  rfc_emisor: string | null;
  nombre_emisor: string | null;
  rfc_receptor: string | null;
  nombre_receptor: string | null;
  total: number;
  subtotal: number;
  sat_status: string;
  fecha_emision: string;
  moneda: string | null;
  forma_pago: string | null;
  metodo_pago: string | null;
  uso_cfdi: string | null;
  lugar_expedicion: string | null;
  descuento: number;
  emisor_regimen: string | null;
  receptor_regimen: string | null;
  efos_status: string | null;
  xml_storage_path: string | null;
  conceptos: Json | null;
  invoice_id: string | null;
  created_at: string;
  updated_at: string | null;
};

// ── Database type ──

export type Database = {
  public: {
    Tables: {
      companies: TableDef<CompanyRow, WithOptional<CompanyRow, 'id' | 'is_active' | 'onboarding_completed' | 'address' | 'phone' | 'logo_url' | 'created_at' | 'updated_at'>>;
      users: TableDef<UserRow, WithOptional<UserRow, 'id' | 'auth_uid' | 'password_hash' | 'role' | 'company_id' | 'is_active' | 'created_at'>>;
      user_companies: TableDef<UserCompanyRow, WithOptional<UserCompanyRow, 'id' | 'is_active' | 'status' | 'invited_by' | 'invited_at' | 'accepted_at' | 'created_at'>>;
      integrations: TableDef<IntegrationRow, WithOptional<IntegrationRow, 'id' | 'is_connected' | 'config' | 'config_encrypted' | 'syntage_credential_id' | 'syntage_taxpayer_id' | 'last_sync' | 'last_sync_at' | 'last_sync_status' | 'last_sync_message' | 'sync_errors' | 'status' | 'created_at' | 'updated_at'>>;
      payments: TableDef<PaymentRow, WithOptional<PaymentRow, 'id' | 'status' | 'currency' | 'partner_name' | 'partner_rfc' | 'reference_id' | 'clabe_origin' | 'clabe_destination' | 'comment' | 'scheduled_date' | 'vendor_id' | 'invoice_id' | 'beneficiary_name' | 'beneficiary_clabe' | 'clabe' | 'concept' | 'reference' | 'confirmed_at' | 'fintoc_transfer_id' | 'fintoc_payment_intent_id' | 'fintoc_error' | 'odoo_payment_id' | 'odoo_synced_at' | 'created_by' | 'executed_at' | 'sat_status' | 'payment_state' | 'reconciled_invoice_ids' | 'odoo_state' | 'created_at' | 'updated_at'>>;
      invoices: TableDef<InvoiceRow, WithOptional<InvoiceRow, 'id' | 'type' | 'partner_name' | 'partner_rfc' | 'amount_total' | 'amount_residual' | 'amount_paid' | 'amount_tax' | 'date_invoice' | 'date_due' | 'status' | 'cfdi_uuid' | 'name' | 'source' | 'sat_status' | 'payment_status' | 'payment_state' | 'vendor_id' | 'customer_id' | 'invoice_number' | 'uuid' | 'issuer_rfc' | 'receiver_rfc' | 'invoice_date' | 'due_date' | 'currency' | 'payment_method' | 'efos_status' | 'cancellable' | 'xml_url' | 'odoo_move_id' | 'odoo_cfdi_uuid' | 'odoo_payment_method' | 'odoo_usage' | 'move_type' | 'invoice_line_count' | 'syntage_invoice_id' | 'validated_at' | 'created_at' | 'updated_at'>>;
      invoice_payments: TableDef<InvoicePaymentRow, WithOptional<InvoicePaymentRow, 'id' | 'created_at'>>;
      cfdi_complements: TableDef<CfdiComplementRow, WithOptional<CfdiComplementRow, 'id' | 'uuid' | 'xml_url' | 'created_at'>>;
      vendors: TableDef<VendorRow, WithOptional<VendorRow, 'id' | 'rfc' | 'email' | 'clabe' | 'is_active' | 'rfc_validated' | 'clabe_verified' | 'clabe_holder_name' | 'bank_name' | 'efos_status' | 'odoo_id' | 'synced_at' | 'phone' | 'regimen_fiscal' | 'supplier_rank' | 'payment_term' | 'created_at' | 'updated_at'>>;
      customers: TableDef<CustomerRow, WithOptional<CustomerRow, 'id' | 'rfc' | 'email' | 'clabe' | 'is_active' | 'fintoc_clabe' | 'fintoc_account_id' | 'odoo_id' | 'phone' | 'regimen_fiscal' | 'customer_rank' | 'payment_term' | 'created_at' | 'updated_at'>>;
      expenses: TableDef<ExpenseRow, WithOptional<ExpenseRow, 'id' | 'employee_name' | 'employee_email' | 'category' | 'description' | 'currency' | 'status' | 'xml_url' | 'rejected_reason' | 'approved_by' | 'created_by' | 'cfdi_uuid' | 'sat_validated' | 'product_category' | 'payment_mode' | 'sheet_id' | 'expense_reference' | 'odoo_id' | 'created_at' | 'updated_at'>>;
      approval_rules: TableDef<ApprovalRuleRow, WithOptional<ApprovalRuleRow, 'id' | 'min_amount' | 'max_amount' | 'amount_min' | 'amount_max' | 'required_approvers' | 'approver_emails' | 'approvers' | 'auto_approve_below' | 'auto_approve' | 'is_active' | 'active' | 'created_at'>>;
      approval_requests: TableDef<ApprovalRequestRow, WithOptional<ApprovalRequestRow, 'id' | 'payment_id' | 'rule_id' | 'status' | 'level' | 'approver_email' | 'amount' | 'partner_name' | 'comment' | 'entity_type' | 'entity_id' | 'requested_by' | 'resolved_by' | 'rejection_reason' | 'resolved_at' | 'created_at'>>;
      budgets: TableDef<BudgetRow, WithOptional<BudgetRow, 'id' | 'name' | 'category' | 'period_start' | 'period_end' | 'amount_budgeted' | 'amount_spent' | 'amount_committed' | 'amount' | 'alert_threshold_pct' | 'is_active' | 'created_at'>>;
      notifications: TableDef<NotificationRow, WithOptional<NotificationRow, 'id' | 'user_id' | 'notification_type' | 'event_type' | 'entity_type' | 'entity_id' | 'title' | 'message' | 'channel' | 'is_read' | 'read' | 'created_at'>>;
      bank_accounts: TableDef<BankAccountRow, WithOptional<BankAccountRow, 'id' | 'bank_name' | 'account_holder' | 'balance' | 'currency' | 'last_synced' | 'created_at'>>;
      bank_movements: TableDef<BankMovementRow, WithOptional<BankMovementRow, 'id' | 'fintoc_id' | 'fintoc_movement_id' | 'account_id' | 'currency' | 'description' | 'post_date' | 'date' | 'type' | 'reference_id' | 'sender_account' | 'counterpart_name' | 'counterpart_account' | 'balance_after' | 'reconciled' | 'reconciled_payment_id' | 'created_at'>>;
      syntage_extractions: TableDef<SyntageExtractionRow, WithOptional<SyntageExtractionRow, 'id' | 'status' | 'records_found' | 'error_message' | 'started_at' | 'completed_at'>>;
      audit_log: TableDef<AuditLogRow, WithOptional<AuditLogRow, 'id' | 'changes' | 'metadata' | 'user_email' | 'description' | 'ip_address' | 'created_at'>>;
      sync_history: TableDef<SyncHistoryRow, WithOptional<SyncHistoryRow, 'id' | 'status' | 'records_synced' | 'error_message' | 'started_at' | 'completed_at'>>;
      webhook_logs: TableDef<WebhookLogRow, WithOptional<WebhookLogRow, 'id' | 'company_id' | 'processed' | 'error' | 'created_at'>>;
      reconciliations: TableDef<ReconciliationRow, WithOptional<ReconciliationRow, 'id' | 'type' | 'status' | 'total_transactions' | 'matched' | 'unmatched' | 'amount_matched' | 'created_at'>>;
      cfdi_documents: TableDef<CfdiDocumentRow, WithOptional<CfdiDocumentRow, 'id' | 'uuid' | 'tipo_comprobante' | 'rfc_emisor' | 'nombre_emisor' | 'rfc_receptor' | 'nombre_receptor' | 'total' | 'subtotal' | 'sat_status' | 'fecha_emision' | 'moneda' | 'forma_pago' | 'metodo_pago' | 'uso_cfdi' | 'lugar_expedicion' | 'descuento' | 'emisor_regimen' | 'receptor_regimen' | 'efos_status' | 'xml_storage_path' | 'conceptos' | 'invoice_id' | 'created_at' | 'updated_at'>>;
    };
    Views: {};
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
