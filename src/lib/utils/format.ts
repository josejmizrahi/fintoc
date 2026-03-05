import { format, formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

export function formatMoney(amount: number, currency = 'MXN') {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(date: string | Date) {
  return format(new Date(date), 'dd/MM/yyyy', { locale: es });
}

export function formatDateISO(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().split('T')[0];
}

export function formatDateTime(date: string | Date) {
  return format(new Date(date), 'dd/MM/yyyy HH:mm', { locale: es });
}

export function formatRelative(date: string | Date) {
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: es });
}

export function formatRFC(rfc: string) {
  return rfc.toUpperCase();
}

export function formatCLABE(clabe: string, masked = true) {
  if (!clabe) return '-';
  if (masked) return `****${clabe.slice(-4)}`;
  return clabe;
}

/**
 * Validate Mexican RFC format (12-13 characters)
 */
export function isValidRFC(rfc: string): boolean {
  const rfcRegex = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
  return rfcRegex.test(rfc.toUpperCase());
}

/**
 * Validate CLABE format (18 digits)
 */
export function isValidCLABE(clabe: string): boolean {
  return /^\d{18}$/.test(clabe);
}

/**
 * Get bank name from CLABE prefix (first 3 digits)
 */
export function getBankFromCLABE(clabe: string): string | null {
  if (!isValidCLABE(clabe)) return null;
  const prefix = clabe.substring(0, 3);
  const banks: Record<string, string> = {
    '002': 'BBVA México', '012': 'BBVA México', '014': 'Santander',
    '021': 'HSBC', '030': 'Bajío', '036': 'Inbursa', '042': 'Mifel',
    '044': 'Scotiabank', '058': 'Banregio', '059': 'Invex',
    '072': 'Banorte', '127': 'Azteca', '130': 'Compartamos',
    '132': 'Multiva', '133': 'Actinver', '134': 'Intercam',
    '143': 'CIBanco', '166': 'Bansefi', '646': 'STP',
    '722': 'Mercado Pago', '723': 'Cuenca',
  };
  return banks[prefix] || null;
}
