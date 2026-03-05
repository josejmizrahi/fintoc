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
