import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import type { SatOdooResult, SatAppResult, BancoAppResult, ReconciliationRecord } from '@/app/(dashboard)/conciliacion/_components/types';

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

/**
 * Transform raw API response to SatOdooResult.
 * The API now returns normalized records directly in `data`.
 */
function transformSatOdooResponse(response: Record<string, unknown>): SatOdooResult {
  const data = (response as { data?: Record<string, unknown> }).data || response;
  return {
    matched: (data.matched as ReconciliationRecord[]) || [],
    in_sat_not_odoo: (data.in_sat_not_odoo as ReconciliationRecord[]) || [],
    in_odoo_not_sat: (data.in_odoo_not_sat as ReconciliationRecord[]) || [],
    amount_differences: (data.amount_differences as ReconciliationRecord[]) || [],
    last_run: (data.last_run as string) || new Date().toISOString(),
  };
}

function transformSatAppResponse(response: Record<string, unknown>): SatAppResult {
  const data = (response as { data?: Record<string, unknown> }).data || response;
  return {
    matched: (data.matched as ReconciliationRecord[]) || [],
    in_sat_only: (data.in_sat_only as ReconciliationRecord[]) || [],
    in_app_only: (data.in_app_only as ReconciliationRecord[]) || [],
    amount_differences: (data.amount_differences as ReconciliationRecord[]) || [],
    last_run: (data.last_run as string) || new Date().toISOString(),
  };
}

function transformBancoAppResponse(response: Record<string, unknown>): BancoAppResult {
  const data = (response as { data?: Record<string, unknown> }).data || response;
  return {
    matched: (data.matched as ReconciliationRecord[]) || [],
    in_banco_only: (data.in_banco_only as ReconciliationRecord[]) || [],
    in_app_only: (data.in_app_only as ReconciliationRecord[]) || [],
    last_run: (data.last_run as string) || new Date().toISOString(),
  };
}

export function useSatOdooReconciliation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { period_start: string; period_end: string }): Promise<SatOdooResult> => {
      const response = await api.reconciliation.satOdoo(data as Record<string, unknown>);
      return transformSatOdooResponse(response);
    },
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
    mutationFn: async (data: { period_start: string; period_end: string }): Promise<SatAppResult> => {
      const response = await api.reconciliation.satApp(data as Record<string, unknown>);
      return transformSatAppResponse(response);
    },
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
    mutationFn: async (data: { period_start: string; period_end: string }): Promise<BancoAppResult> => {
      const response = await api.reconciliation.bancoApp(data as Record<string, unknown>);
      return transformBancoAppResponse(response);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reconciliationKeys.all });
      toast.success('Conciliacion Banco-App completada');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error en conciliacion Banco-App');
    },
  });
}

export function useImportToOdoo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { cfdi_uuid: string }) => api.reconciliation.importToOdoo(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reconciliationKeys.all });
      toast.success('CFDI importado a Odoo exitosamente');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al importar a Odoo');
    },
  });
}

export function useValidateCfdi() {
  return useMutation({
    mutationFn: (data: { uuid: string }) => api.sat.validate(data),
    onSuccess: () => {
      toast.success('Verificacion SAT completada');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al verificar en SAT');
    },
  });
}
