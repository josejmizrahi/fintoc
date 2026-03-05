export const STATUS_COLORS = {
  confirmed: { bg: 'bg-green-100', text: 'text-green-800', label: 'Confirmado' },
  paid: { bg: 'bg-green-100', text: 'text-green-800', label: 'Pagado' },
  active: { bg: 'bg-green-100', text: 'text-green-800', label: 'Activo' },
  vigente: { bg: 'bg-green-100', text: 'text-green-800', label: 'Vigente' },
  pending: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Pendiente' },
  draft: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Borrador' },
  pending_approval: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Por aprobar' },
  failed: { bg: 'bg-red-100', text: 'text-red-800', label: 'Fallido' },
  rejected: { bg: 'bg-red-100', text: 'text-red-800', label: 'Rechazado' },
  cancelled: { bg: 'bg-red-100', text: 'text-red-800', label: 'Cancelado' },
  cancelado: { bg: 'bg-red-100', text: 'text-red-800', label: 'Cancelado' },
  processing: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Procesando' },
  scheduled: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Programado' },
  overdue: { bg: 'bg-red-200', text: 'text-red-900', label: 'Vencido' },
  partial: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Parcial' },
  not_paid: { bg: 'bg-red-100', text: 'text-red-800', label: 'No pagado' },
  approved: { bg: 'bg-green-100', text: 'text-green-800', label: 'Aprobado' },
  completed: { bg: 'bg-green-100', text: 'text-green-800', label: 'Completado' },
} as const;

export type StatusKey = keyof typeof STATUS_COLORS;

export const EXPENSE_CATEGORIES = [
  'Viaje',
  'Comida',
  'Material',
  'Transporte',
  'Otro',
] as const;

export const CANCELLATION_MOTIVOS = [
  { value: '01', label: '01 - Comprobante emitido con errores con relacion' },
  { value: '02', label: '02 - Comprobante emitido sin relacion' },
  { value: '03', label: '03 - No se llevo a cabo la operacion' },
  { value: '04', label: '04 - Operacion nominativa relacionada con factura global' },
] as const;

export const CLABE_BANKS: Record<string, string> = {
  '002': 'BBVA',
  '012': 'HSBC',
  '014': 'Santander',
  '021': 'HSBC',
  '030': 'Bajio',
  '036': 'Inbursa',
  '044': 'Scotiabank',
  '058': 'Banregio',
  '072': 'Banorte',
  '106': 'Bank of America',
  '127': 'Azteca',
  '130': 'STP',
  '138': 'ABCCAPITAL',
  '646': 'STP',
};

export function getBankFromCLABE(clabe: string): string {
  if (!clabe || clabe.length < 3) return '';
  return CLABE_BANKS[clabe.slice(0, 3)] || 'Desconocido';
}
