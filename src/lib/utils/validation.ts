import { z } from 'zod';

// Re-export common validators from canonical schemas
export {
  rfcSchema,
  clabeSchema,
  emailSchema,
} from '@/lib/validations/schemas';

// Frontend-specific validators
export const moneySchema = z
  .number()
  .positive('Monto debe ser mayor a 0')
  .multipleOf(0.01, 'Maximo 2 decimales');

export const uuidCfdiSchema = z.string().uuid('UUID CFDI invalido');

export const passwordSchema = z
  .string()
  .min(8, 'Minimo 8 caracteres')
  .regex(/[A-Z]/, 'Debe contener al menos 1 mayuscula')
  .regex(/[0-9]/, 'Debe contener al menos 1 numero');

// --- Auth (frontend-only: includes confirm_password) ---
export const loginSchema = z.object({
  email: z.string().email('Email invalido'),
  password: z.string().min(1, 'Password requerido'),
});

export const registerSchema = z
  .object({
    company_name: z.string().min(2, 'Nombre de empresa requerido'),
    rfc: z
      .string()
      .min(12, 'RFC invalido')
      .max(13, 'RFC invalido')
      .transform((v) => v.toUpperCase()),
    full_name: z.string().min(2, 'Nombre requerido').max(100).optional(),
    email: z.string().email('Email invalido'),
    password: passwordSchema,
    confirm_password: z.string(),
  })
  .refine((d) => d.password === d.confirm_password, {
    message: 'Las contraseñas no coinciden',
    path: ['confirm_password'],
  });

export const resetPasswordSchema = z.object({
  email: z.string().email('Email invalido'),
});

// --- Payments (frontend form: includes display fields) ---
export const createPaymentSchema = z.object({
  vendor_id: z.string().min(1, 'Proveedor requerido'),
  vendor_name: z.string().optional(),
  invoice_id: z.string().optional(),
  amount: moneySchema,
  clabe: z.string().optional(),
  concept: z
    .string()
    .min(1, 'Concepto requerido')
    .max(40, 'Maximo 40 caracteres (limite SPEI)'),
  reference: z.string().max(7, 'Maximo 7 digitos').optional(),
  scheduled_date: z.string().optional(),
});

// --- Vendors (frontend form) ---
export const createVendorSchema = z.object({
  name: z.string().min(2, 'Nombre requerido'),
  rfc: z
    .string()
    .min(12, 'RFC invalido')
    .max(13, 'RFC invalido')
    .transform((v) => v.toUpperCase())
    .optional()
    .or(z.literal('')),
  email: z.string().email('Email invalido').optional().or(z.literal('')),
  phone: z.string().optional(),
  clabe: z
    .string()
    .optional()
    .refine((v) => !v || /^\d{18}$/.test(v), 'CLABE debe tener 18 digitos'),
});

// --- Customers (frontend form) ---
export const createCustomerSchema = z.object({
  name: z.string().min(2, 'Nombre requerido'),
  rfc: z
    .string()
    .min(12, 'RFC invalido')
    .max(13, 'RFC invalido')
    .transform((v) => v.toUpperCase())
    .optional()
    .or(z.literal('')),
  email: z.string().email('Email invalido').optional().or(z.literal('')),
  phone: z.string().optional(),
});

// --- Expenses (frontend form) ---
export const createExpenseSchema = z.object({
  employee_name: z.string().min(1, 'Empleado requerido'),
  category: z.string().min(1, 'Categoria requerida'),
  description: z.string().max(200, 'Maximo 200 caracteres').optional(),
  amount: moneySchema,
  date: z.string().min(1, 'Fecha requerida'),
});

// --- Budgets (frontend form) ---
export const createBudgetSchema = z.object({
  name: z.string().min(1, 'Nombre requerido').optional(),
  category: z.string().min(1, 'Categoria requerida'),
  period_start: z.string().min(1, 'Fecha inicio requerida'),
  period_end: z.string().min(1, 'Fecha fin requerida'),
  amount_budgeted: moneySchema,
});

// --- SAT (frontend form) ---
export const satValidateSchema = z.object({
  uuid: uuidCfdiSchema,
  rfc_emisor: z.string().min(12, 'RFC Emisor requerido'),
  rfc_receptor: z.string().min(12, 'RFC Receptor requerido'),
  total: z.number().positive('Total debe ser mayor a 0'),
});
