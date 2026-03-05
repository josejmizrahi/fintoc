import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const treasuryKeys = {
  all: ['treasury'] as const,
  snapshot: () => [...treasuryKeys.all, 'snapshot'] as const,
  forecast: (days?: number) => [...treasuryKeys.all, 'forecast', days] as const,
  movements: (filters: Record<string, unknown>) => [...treasuryKeys.all, 'movements', filters] as const,
  balance: () => [...treasuryKeys.all, 'balance'] as const,
};

export function useTreasurySnapshot() {
  return useQuery({
    queryKey: treasuryKeys.snapshot(),
    queryFn: () => api.treasury.snapshot(),
    staleTime: 30_000,
  });
}

export function useTreasuryForecast(days?: number) {
  return useQuery({
    queryKey: treasuryKeys.forecast(days),
    queryFn: () => api.treasury.forecast(days),
    staleTime: 30_000,
  });
}

export function useTreasuryMovements(filters: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: treasuryKeys.movements(filters),
    queryFn: () => api.treasury.movements(filters),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useTreasuryBalance() {
  return useQuery({
    queryKey: treasuryKeys.balance(),
    queryFn: () => api.treasury.balance(),
    staleTime: 30_000,
  });
}
