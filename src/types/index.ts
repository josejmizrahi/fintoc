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
  jwsKeyPath: string;
  connected: boolean;
}

export interface SATConfig {
  rfcEmisor: string;
  certificatePath: string;
  keyPath: string;
  keyPassword: string;
  pacProvider: string;
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

export interface Payment {
  id: number;
  direction: "inbound" | "outbound";
  status: string;
  amount: number;
  currency: string;
  clabe_destination?: string;
  reference_id?: string;
  partner_name?: string;
  fintoc_transfer_id?: string;
  cfdi_uuid?: string;
  sat_status?: string;
  executed_at?: string;
  created_at?: string;
}

export interface Invoice {
  id: number;
  name: string;
  partner_id?: number;
  partner?: string;
  amount_total?: number;
  amount_residual?: number;
  amount?: number;
  invoice_date_due?: string;
  due_date?: string;
  move_type?: string;
  cfdi_uuid?: string;
  payment_state?: string;
}

export interface Vendor {
  id: number;
  name: string;
  rfc?: string;
  email?: string;
  clabe?: string;
}

export interface Customer {
  id: number;
  name: string;
  rfc?: string;
  email?: string;
  clabe?: string;
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
