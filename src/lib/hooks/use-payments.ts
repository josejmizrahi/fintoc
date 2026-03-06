import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export const paymentKeys = {
  all: ['payments'] as const,
  lists: () => [...paymentKeys.all, 'list'] as const,
  list: (filters: Record<string, unknown>) => [...paymentKeys.lists(), filters] as const,
  details: () => [...paymentKeys.all, 'detail'] as const,
  detail: (id: string) => [...paymentKeys.details(), id] as const,
};

export function usePayments(filters: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: paymentKeys.list(filters),
    queryFn: () => api.payments.list(filters),
    staleTime: 10_000,
    placeholderData: keepPreviousData,
  });
}

export function usePayment(id: string) {
  return useQuery({
    queryKey: paymentKeys.detail(id),
    queryFn: () => api.payments.get(id),
    staleTime: 10_000,
    enabled: !!id,
  });
}

export function useCreatePayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.payments.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: paymentKeys.all });
      toast.success('Pago creado exitosamente');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al crear pago');
    },
  });
}

export function useExecutePayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (paymentId: string) => api.payments.execute({ payment_id: paymentId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: paymentKeys.all });
      toast.success('Pago ejecutado exitosamente');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al ejecutar pago');
    },
  });
}

export function useExecuteBatchPayments() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (paymentIds: (string)[]) => api.payments.executeBatch({ payment_ids: paymentIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: paymentKeys.all });
      toast.success('Pagos ejecutados exitosamente');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al ejecutar pagos');
    },
  });
}

export function useCancelPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.payments.cancel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: paymentKeys.all });
      toast.success('Pago cancelado exitosamente');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al cancelar pago');
    },
  });
}

export function useRetryPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.payments.retry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: paymentKeys.all });
      toast.success('Pago reintentado exitosamente');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al reintentar pago');
    },
  });
}
