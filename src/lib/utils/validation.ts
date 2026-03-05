import { z } from 'zod';

export const rfcSchema = z
  .string()
  .min(12, 'RFC debe tener al menos 12 caracteres')
  .max(13, 'RFC debe tener maximo 13 caracteres')
  .regex(/^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/, 'RFC invalido')
  .transform((v) => v.toUpperCase());

export const clabeSchema = z
  .string()
  .length(18, 'CLABE debe tener 18 digitos')
  .regex(/^\d{18}$/, 'CLABE solo acepta numeros');

export const moneySchema = z
  .number()
  .positive('Monto debe ser mayor a 0')
  .multipleOf(0.01, 'Maximo 2 decimales');

export const uuidCfdiSchema = z.string().uuid('UUID CFDI invalido');

export const emailSchema = z.string().email('Email invalido');

export const passwordSchema = z
  .string()
  .min(8, 'Minimo 8 caracteres')
  .regex(/[A-Z]/, 'Debe contener al menos 1 mayuscula')
  .regex(/[0-9]/, 'Debe contener al menos 1 numero');

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

export const createPaymentSchema = z.object({
  vendor_id: z.number().or(z.string()).optional(),
  vendor_name: z.string().min(1, 'Proveedor requerido'),
  invoice_id: z.number().optional(),
  amount: moneySchema,
  clabe: clabeSchema,
  concept: z
    .string()
    .min(1, 'Concepto requerido')
    .max(40, 'Maximo 40 caracteres (limite SPEI)'),
  reference: z.string().max(7, 'Maximo 7 digitos').optional(),
  scheduled_date: z.string().optional(),
});

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

export const createExpenseSchema = z.object({
  employee_name: z.string().min(1, 'Empleado requerido'),
  category: z.string().min(1, 'Categoria requerida'),
  description: z.string().min(1, 'Descripcion requerida').max(200, 'Maximo 200 caracteres'),
  amount: moneySchema,
  date: z.string().min(1, 'Fecha requerida'),
});

export const createBudgetSchema = z.object({
  name: z.string().min(1, 'Nombre requerido'),
  category: z.string().min(1, 'Categoria requerida'),
  period_start: z.string().min(1, 'Fecha inicio requerida'),
  period_end: z.string().min(1, 'Fecha fin requerida'),
  amount_budgeted: moneySchema,
});

export const satValidateSchema = z.object({
  uuid: uuidCfdiSchema,
  rfc_emisor: z.string().min(12, 'RFC Emisor requerido'),
  rfc_receptor: z.string().min(12, 'RFC Receptor requerido'),
  total: z.number().positive('Total debe ser mayor a 0'),
});
