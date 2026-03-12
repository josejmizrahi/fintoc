import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export const reconciliationKeys = {
  all: ['reconciliation'] as const,
  history: () => [...reconciliationKeys.all, 'history'] as const,
};

export function useReconciliationHistory() {
  return useQuery({
    queryKey: reconciliationKeys.history(),
    queryFn: () => api.reconciliation.history(),
  });
}

export function useSatOdooReconciliation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { period_start: string; period_end: string }) => api.reconciliation.satOdoo(data as Record<string, unknown>),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reconciliationKeys.all });
      toast.success('Conciliacion SAT-Odoo completada');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error en conciliacion SAT-Odoo');
    },
  });
}

export function useSatAppReconciliation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { period_start: string; period_end: string }) => api.reconciliation.satApp(data as Record<string, unknown>),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reconciliationKeys.all });
      toast.success('Conciliacion SAT-App completada');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error en conciliacion SAT-App');
    },
  });
}

export function useBancoAppReconciliation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { period_start: string; period_end: string }) => api.reconciliation.bancoApp(data as Record<string, unknown>),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reconciliationKeys.all });
      toast.success('Conciliacion Banco-App completada');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error en conciliacion Banco-App');
    },
  });
}
