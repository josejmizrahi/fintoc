import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const invoiceKeys = {
  all: ['invoices'] as const,
  payable: (filters: Record<string, unknown>) => [...invoiceKeys.all, 'payable', filters] as const,
  receivable: (filters: Record<string, unknown>) => [...invoiceKeys.all, 'receivable', filters] as const,
  details: () => [...invoiceKeys.all, 'detail'] as const,
  detail: (id: number | string) => [...invoiceKeys.details(), id] as const,
  cfdi: (id: number | string) => [...invoiceKeys.all, 'cfdi', id] as const,
};

export function usePayableInvoices(filters: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: invoiceKeys.payable(filters),
    queryFn: () => api.invoices.payable(filters),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useReceivableInvoices(filters: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: invoiceKeys.receivable(filters),
    queryFn: () => api.invoices.receivable(filters),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useInvoice(id: number | string) {
  return useQuery({
    queryKey: invoiceKeys.detail(id),
    queryFn: () => api.invoices.get(id),
    staleTime: 30_000,
    enabled: !!id,
  });
}

export function useInvoiceCfdi(id: number | string) {
  return useQuery({
    queryKey: invoiceKeys.cfdi(id),
    queryFn: () => api.invoices.cfdi(id),
    staleTime: 30_000,
    enabled: !!id,
  });
}
