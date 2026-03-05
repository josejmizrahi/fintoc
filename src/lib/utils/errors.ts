export class ApiError extends Error {
  constructor(
    public code: string,
    public override message: string,
    public status: number = 400,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const ErrorCodes = {
  // Auth
  INVALID_CREDENTIALS: { code: 'INVALID_CREDENTIALS', status: 401, message: 'Email o password incorrectos' },
  TOKEN_EXPIRED: { code: 'TOKEN_EXPIRED', status: 401, message: 'Token expirado' },
  FORBIDDEN: { code: 'FORBIDDEN', status: 403, message: 'Sin permisos para esta accion' },
  NOT_MEMBER: { code: 'NOT_MEMBER', status: 403, message: 'Usuario no es miembro de esta empresa' },
  EMAIL_ALREADY_EXISTS: { code: 'EMAIL_ALREADY_EXISTS', status: 409, message: 'Email ya registrado' },
  COMPANY_RFC_EXISTS: { code: 'COMPANY_RFC_EXISTS', status: 409, message: 'RFC de empresa ya existe' },
  NO_COMPANIES: { code: 'NO_COMPANIES', status: 403, message: 'Usuario sin empresas asignadas' },

  // Payments
  VENDOR_EFOS_BLOCKED: { code: 'VENDOR_EFOS_BLOCKED', status: 422, message: 'Proveedor en lista EFOS definitiva. Pagos bloqueados.' },
  VENDOR_NO_CLABE: { code: 'VENDOR_NO_CLABE', status: 422, message: 'Proveedor no tiene CLABE registrada' },
  PAYMENT_NOT_EXECUTABLE: { code: 'PAYMENT_NOT_EXECUTABLE', status: 422, message: 'Pago no esta en status ejecutable' },
  PAYMENT_PENDING_APPROVAL: { code: 'PAYMENT_PENDING_APPROVAL', status: 422, message: 'Pago requiere aprobacion antes de ejecutar' },
  FINTOC_ERROR: { code: 'FINTOC_ERROR', status: 502, message: 'Error al procesar pago' },
  FINTOC_INSUFFICIENT_FUNDS: { code: 'FINTOC_INSUFFICIENT_FUNDS', status: 422, message: 'Saldo insuficiente en cuenta bancaria' },

  // Invoices / SAT
  INVOICE_NOT_CANCELLABLE: { code: 'INVOICE_NOT_CANCELLABLE', status: 422, message: 'El SAT no permite cancelar esta factura' },
  SYNTAGE_ERROR: { code: 'SYNTAGE_ERROR', status: 502, message: 'Error al consultar SAT' },
  ODOO_ERROR: { code: 'ODOO_ERROR', status: 502, message: 'Error al sincronizar con Odoo' },
  INTEGRATION_TIMEOUT: { code: 'INTEGRATION_TIMEOUT', status: 504, message: 'Timeout al comunicarse con servicio externo' },
  INTEGRATION_NOT_CONFIGURED: { code: 'INTEGRATION_NOT_CONFIGURED', status: 422, message: 'Integracion no configurada' },

  // General
  VALIDATION_ERROR: { code: 'VALIDATION_ERROR', status: 400, message: 'Error de validacion' },
  NOT_FOUND: { code: 'NOT_FOUND', status: 404, message: 'Recurso no encontrado' },
  DUPLICATE: { code: 'DUPLICATE', status: 409, message: 'Recurso duplicado' },
  RATE_LIMITED: { code: 'RATE_LIMITED', status: 429, message: 'Demasiadas requests' },
  INTERNAL_ERROR: { code: 'INTERNAL_ERROR', status: 500, message: 'Error interno del servidor' },
} as const;
