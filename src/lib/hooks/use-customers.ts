import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export const customerKeys = {
  all: ['customers'] as const,
  lists: () => [...customerKeys.all, 'list'] as const,
  list: (filters: Record<string, unknown>) => [...customerKeys.lists(), filters] as const,
  details: () => [...customerKeys.all, 'detail'] as const,
  detail: (id: string) => [...customerKeys.details(), id] as const,
};

export function useCustomers(filters: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: customerKeys.list(filters),
    queryFn: () => api.customers.list(filters),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useCustomer(id: string) {
  return useQuery({
    queryKey: customerKeys.detail(id),
    queryFn: () => api.customers.get(id),
    staleTime: 30_000,
    enabled: !!id,
  });
}

export function useCreateCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.customers.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: customerKeys.all });
      toast.success('Cliente creado exitosamente');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al crear cliente');
    },
  });
}

export function useUpdateCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.customers.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: customerKeys.all });
      toast.success('Cliente actualizado exitosamente');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al actualizar cliente');
    },
  });
}

export function useCreateCustomerClabe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.customers.createClabe(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: customerKeys.all });
      toast.success('CLABE creada exitosamente');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al crear CLABE');
    },
  });
}
