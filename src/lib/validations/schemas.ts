import { z } from 'zod';

// --- Common validators ---
// Entity IDs: database uses integer PKs. Accept both numbers and numeric strings.
const entityId = z.union([z.number().int().positive(), z.string().regex(/^\d+$/, 'ID must be numeric')]).transform(v => typeof v === 'string' ? parseInt(v, 10) : v);
const rfcRegex = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;

/**
 * Validates CLABE check digit (last digit) using the standard modulus 10 algorithm.
 * Weights cycle: [3, 7, 1] applied to each digit, summed mod 10, check = (10 - sum) mod 10.
 */
function isValidClabe(clabe: string): boolean {
  if (!/^\d{18}$/.test(clabe)) return false;
  const weights = [3, 7, 1];
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    sum += (parseInt(clabe[i], 10) * weights[i % 3]) % 10;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === parseInt(clabe[17], 10);
}

export const rfcSchema = z.string().min(12).max(13).regex(rfcRegex, 'Formato de RFC invalido');
export const clabeSchema = z.string().length(18).refine(isValidClabe, { message: 'CLABE invalida (digito verificador incorrecto)' });
export const emailSchema = z.string().email().transform(v => v.toLowerCase());

// --- Auth ---
export const registerSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).regex(/[A-Z]/, 'Debe contener al menos 1 mayuscula').regex(/\d/, 'Debe contener al menos 1 numero'),
  full_name: z.string().min(2).max(100).optional(),
  company_name: z.string().min(2).max(200),
  rfc: rfcSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});

export const switchCompanySchema = z.object({
  company_id: entityId,
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
  vendor_id: entityId,
  invoice_id: entityId.optional(),
  amount: z.number().positive('Monto debe ser mayor a 0'),
  concept: z.string().min(1).max(40, 'Concepto SPEI max 40 caracteres'),
  reference: z.string().max(7).regex(/^\d*$/, 'Referencia debe ser numerica').optional(),
  scheduled_date: z.string().date().optional(),
});

export const paymentUpdateSchema = z.object({
  vendor_id: entityId.optional(),
  amount: z.number().positive().optional(),
  concept: z.string().min(1).max(40).optional(),
  reference: z.string().max(7).regex(/^\d*$/).optional(),
  scheduled_date: z.string().date().optional(),
});

export const paymentExecuteSchema = z.object({
  payment_id: entityId,
});

export const paymentExecuteBatchSchema = z.object({
  payment_ids: z.array(entityId).min(1).max(50),
});

// --- Invoices ---
export const invoiceCreateSchema = z.object({
  type: z.enum(['receivable', 'payable']),
  vendor_id: entityId.optional(),
  customer_id: entityId.optional(),
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
  invoice_id: entityId,
});

export const satValidateBulkSchema = z.object({
  invoice_ids: z.array(entityId).optional(),
});

export const satCancelSchema = z.object({
  invoice_id: entityId,
  motivo: z.enum(['01', '02', '03', '04']),
  uuid_sustituto: z.string().max(36).optional(),
});

export const satExtractSchema = z.object({
  extractor: z.enum([
    'invoices', 'tax_returns', 'tax_status', 'tax_compliance_checks',
    'tax_retentions', 'electronic_accounting', 'sat_certificates',
    'expense_receipts', 'accounting_data',
  ]),
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
  rfc: rfcSchema.optional(),
  email: z.string().email().optional(),
  phone: z.string().max(15).optional(),
  clabe: clabeSchema.optional(),
});

export const vendorUpdateSchema = vendorCreateSchema.partial();

export const verifyClabeSchema = z.object({
  vendor_id: entityId,
});

// --- Customers ---
export const customerCreateSchema = z.object({
  name: z.string().min(2).max(200),
  rfc: rfcSchema.optional(),
  email: z.string().email().optional(),
  phone: z.string().max(15).optional(),
});

export const customerUpdateSchema = customerCreateSchema.partial();

export const createClabeSchema = z.object({
  customer_id: entityId,
});

// --- Expenses ---
export const expenseCreateSchema = z.object({
  employee_name: z.string().min(1).max(200),
  category: z.string().min(1).max(100),
  description: z.string().max(200).optional(),
  amount: z.number().positive(),
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
  approvers: z.array(z.string()).min(1), // user UUIDs from Supabase Auth
  auto_approve: z.boolean().default(false),
});

export const approvalRuleUpdateSchema = approvalRuleCreateSchema.partial();

export const approvalActionSchema = z.object({
  request_id: entityId,
});

export const approvalRejectSchema = z.object({
  request_id: entityId,
  reason: z.string().min(1),
});

// --- Budgets ---
export const budgetCreateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  category: z.string().min(1).max(100),
  period_start: z.string().date(),
  period_end: z.string().date(),
  amount_budgeted: z.number().positive(),
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
  invoice_id: entityId,
  amount: z.number().positive().optional(),
});

export const sendReminderSchema = z.object({
  invoice_id: entityId,
  to_email: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1),
});

// --- Notifications ---
export const markReadSchema = z.object({
  notification_ids: z.array(entityId).optional(),
});

// --- Search ---
export const searchSchema = z.object({
  q: z.string().min(2),
});

// --- Fintoc ---
export const fintocExchangeSchema = z.object({
  exchange_token: z.string().min(1, 'exchange_token es requerido'),
});

// --- Onboarding ---
export const onboardingActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('complete'),
  }),
  z.object({
    action: z.literal('test'),
    provider: z.enum(['odoo', 'fintoc', 'sat', 'general']),
    config: z.record(z.string(), z.string()),
  }),
  z.object({
    action: z.literal('save'),
    provider: z.enum(['odoo', 'fintoc', 'sat', 'general']),
    config: z.record(z.string(), z.string()),
  }),
]);
