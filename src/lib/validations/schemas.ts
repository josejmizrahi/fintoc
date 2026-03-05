import { z } from 'zod';

// --- Common validators ---
const uuid = z.string().uuid();
const rfcRegex = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
const clabeRegex = /^\d{18}$/;

export const rfcSchema = z.string().min(12).max(13).regex(rfcRegex, 'Formato de RFC invalido');
export const clabeSchema = z.string().length(18).regex(clabeRegex, 'CLABE debe ser 18 digitos');
export const emailSchema = z.string().email().transform(v => v.toLowerCase());

// --- Auth ---
export const registerSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).regex(/[A-Z]/, 'Debe contener al menos 1 mayuscula').regex(/\d/, 'Debe contener al menos 1 numero'),
  full_name: z.string().min(2).max(100),
  company_name: z.string().min(2).max(200),
  company_rfc: rfcSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});

export const switchCompanySchema = z.object({
  company_id: uuid,
});

export const inviteUserSchema = z.object({
  email: emailSchema,
  role: z.enum(['admin', 'accountant', 'viewer']),
});

export const updateRoleSchema = z.object({
  role: z.enum(['admin', 'accountant', 'viewer']),
});

// --- Payments ---
export const paymentCreateSchema = z.object({
  vendor_id: uuid,
  invoice_id: uuid.optional(),
  amount: z.number().positive('Monto debe ser mayor a 0'),
  concept: z.string().min(1).max(40, 'Concepto SPEI max 40 caracteres'),
  reference: z.string().max(7).regex(/^\d*$/, 'Referencia debe ser numerica').optional(),
  scheduled_date: z.string().date().optional(),
});

export const paymentUpdateSchema = z.object({
  vendor_id: uuid.optional(),
  amount: z.number().positive().optional(),
  concept: z.string().min(1).max(40).optional(),
  reference: z.string().max(7).regex(/^\d*$/).optional(),
  scheduled_date: z.string().date().optional(),
});

export const paymentExecuteSchema = z.object({
  payment_id: uuid,
});

export const paymentExecuteBatchSchema = z.object({
  payment_ids: z.array(uuid).min(1).max(50),
});

// --- Invoices ---
export const invoiceCreateSchema = z.object({
  type: z.enum(['in_invoice', 'out_invoice']),
  vendor_id: uuid.optional(),
  customer_id: uuid.optional(),
  invoice_number: z.string().max(50).optional(),
  uuid: z.string().max(36).optional(),
  issuer_rfc: rfcSchema.optional(),
  receiver_rfc: rfcSchema.optional(),
  invoice_date: z.string().date(),
  due_date: z.string().date().optional(),
  amount_total: z.number().positive(),
  currency: z.enum(['MXN', 'USD']).default('MXN'),
  payment_method: z.enum(['PUE', 'PPD']).optional(),
  source: z.enum(['odoo', 'sat', 'manual']).default('manual'),
});

export const invoiceUpdateSchema = invoiceCreateSchema.partial();

// --- SAT ---
export const satValidateSchema = z.object({
  invoice_id: uuid,
});

export const satValidateBulkSchema = z.object({
  invoice_ids: z.array(uuid).optional(),
});

export const satCancelSchema = z.object({
  invoice_id: uuid,
  motivo: z.enum(['01', '02', '03', '04']),
  uuid_sustituto: z.string().max(36).optional(),
});

export const satExtractSchema = z.object({
  extractor: z.enum(['invoice', 'tax_status', 'tax_retention', 'tax_compliance', 'tax_return']),
  date_from: z.string().date().optional(),
  date_to: z.string().date().optional(),
});

export const satValidateRfcSchema = z.object({
  rfc: rfcSchema,
});

export const satCheckEfosSchema = z.object({
  rfc: rfcSchema,
});

// --- Reconciliation ---
export const reconciliationPeriodSchema = z.object({
  period_start: z.string().date(),
  period_end: z.string().date(),
});

export const importToOdooSchema = z.object({
  cfdi_uuid: z.string().min(1),
});

// --- Vendors ---
export const vendorCreateSchema = z.object({
  name: z.string().min(2).max(200),
  rfc: rfcSchema,
  email: z.string().email().optional(),
  phone: z.string().max(15).optional(),
  clabe: clabeSchema.optional(),
});

export const vendorUpdateSchema = vendorCreateSchema.partial();

export const verifyClabeSchema = z.object({
  vendor_id: uuid,
});

// --- Customers ---
export const customerCreateSchema = z.object({
  name: z.string().min(2).max(200),
  rfc: rfcSchema,
  email: z.string().email().optional(),
  phone: z.string().max(15).optional(),
});

export const customerUpdateSchema = customerCreateSchema.partial();

export const createClabeSchema = z.object({
  customer_id: uuid,
});

// --- Expenses ---
export const expenseCreateSchema = z.object({
  employee_name: z.string().min(1).max(200),
  category: z.enum(['travel', 'meal', 'material', 'transport', 'other']),
  description: z.string().min(1).max(200),
  amount: z.number().positive(),
  expense_date: z.string().date(),
  xml_url: z.string().url().optional(),
  cfdi_uuid: z.string().max(36).optional(),
});

export const expenseRejectSchema = z.object({
  reason: z.string().min(1),
});

// --- Approval Rules ---
export const approvalRuleCreateSchema = z.object({
  name: z.string().min(1).max(100),
  amount_min: z.number().min(0),
  amount_max: z.number().positive().optional(),
  approvers: z.array(uuid).min(1),
  auto_approve: z.boolean().default(false),
});

export const approvalRuleUpdateSchema = approvalRuleCreateSchema.partial();

export const approvalActionSchema = z.object({
  request_id: uuid,
});

export const approvalRejectSchema = z.object({
  request_id: uuid,
  reason: z.string().min(1),
});

// --- Budgets ---
export const budgetCreateSchema = z.object({
  category: z.string().min(1).max(100),
  period_start: z.string().date(),
  period_end: z.string().date(),
  amount: z.number().positive(),
});

export const budgetUpdateSchema = budgetCreateSchema.partial();

// --- Companies ---
export const companyUpdateSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  rfc: rfcSchema.optional(),
  address: z.string().optional(),
  phone: z.string().max(15).optional(),
  logo_url: z.string().url().optional(),
});

// --- Onboarding ---
export const onboardingSchema = z.object({
  step: z.enum(['test', 'sat', 'complete']),
  provider: z.enum(['odoo', 'fintoc', 'syntage']).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

// --- Collections ---
export const paymentLinkSchema = z.object({
  invoice_id: uuid,
  amount: z.number().positive().optional(),
});

export const sendReminderSchema = z.object({
  invoice_id: uuid,
  to_email: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1),
});

// --- Notifications ---
export const markReadSchema = z.object({
  notification_ids: z.array(uuid).optional(),
});

// --- Search ---
export const searchSchema = z.object({
  q: z.string().min(2),
});
