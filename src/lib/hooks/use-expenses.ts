import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export const expenseKeys = {
  all: ['expenses'] as const,
  lists: () => [...expenseKeys.all, 'list'] as const,
  list: (filters: Record<string, unknown>) => [...expenseKeys.lists(), filters] as const,
};

export function useExpenses(filters: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: expenseKeys.list(filters),
    queryFn: () => api.expenses.list(filters),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useCreateExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.expenses.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: expenseKeys.all });
      toast.success('Gasto creado exitosamente');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al crear gasto');
    },
  });
}

export function useApproveExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number | string) => api.expenses.approve(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: expenseKeys.all });
      toast.success('Gasto aprobado exitosamente');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al aprobar gasto');
    },
  });
}

export function useRejectExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number | string; reason: string }) => api.expenses.reject(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: expenseKeys.all });
      toast.success('Gasto rechazado');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al rechazar gasto');
    },
  });
}
