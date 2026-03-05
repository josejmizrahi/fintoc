import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const reportKeys = {
  all: ['reports'] as const,
  cashFlow: (params: Record<string, unknown>) => [...reportKeys.all, 'cash-flow', params] as const,
  aging: (params: Record<string, unknown>) => [...reportKeys.all, 'aging', params] as const,
  satCompliance: (params: Record<string, unknown>) => [...reportKeys.all, 'sat-compliance', params] as const,
  budgetVsActual: () => [...reportKeys.all, 'budget-vs-actual'] as const,
  vendorSummary: () => [...reportKeys.all, 'vendor-summary'] as const,
  customerSummary: () => [...reportKeys.all, 'customer-summary'] as const,
};

export function useCashFlowReport(params: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: reportKeys.cashFlow(params),
    queryFn: () => api.reports.cashFlow(params),
    staleTime: 60_000,
  });
}

export function useAgingReport(params: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: reportKeys.aging(params),
    queryFn: () => api.reports.aging(params),
    staleTime: 60_000,
  });
}

export function useSatComplianceReport(params: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: reportKeys.satCompliance(params),
    queryFn: () => api.reports.satCompliance(params),
    staleTime: 60_000,
  });
}

export function useBudgetVsActualReport() {
  return useQuery({
    queryKey: reportKeys.budgetVsActual(),
    queryFn: () => api.reports.budgetVsActual(),
    staleTime: 60_000,
  });
}

export function useVendorSummaryReport() {
  return useQuery({
    queryKey: reportKeys.vendorSummary(),
    queryFn: () => api.reports.vendorSummary(),
    staleTime: 60_000,
  });
}

export function useCustomerSummaryReport() {
  return useQuery({
    queryKey: reportKeys.customerSummary(),
    queryFn: () => api.reports.customerSummary(),
    staleTime: 60_000,
  });
}
