import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export const vendorKeys = {
  all: ['vendors'] as const,
  lists: () => [...vendorKeys.all, 'list'] as const,
  list: (filters: Record<string, unknown>) => [...vendorKeys.lists(), filters] as const,
  details: () => [...vendorKeys.all, 'detail'] as const,
  detail: (id: string) => [...vendorKeys.details(), id] as const,
};

export function useVendors(filters: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: vendorKeys.list(filters),
    queryFn: () => api.vendors.list(filters),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useVendor(id: string) {
  return useQuery({
    queryKey: vendorKeys.detail(id),
    queryFn: () => api.vendors.get(id),
    staleTime: 30_000,
    enabled: !!id,
  });
}

export function useCreateVendor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.vendors.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vendorKeys.all });
      toast.success('Proveedor creado exitosamente');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al crear proveedor');
    },
  });
}

export function useUpdateVendor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => api.vendors.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vendorKeys.all });
      toast.success('Proveedor actualizado exitosamente');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al actualizar proveedor');
    },
  });
}

export function useVerifyVendorClabe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.vendors.verifyClabe(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vendorKeys.all });
      toast.success('CLABE verificada exitosamente');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al verificar CLABE');
    },
  });
}
