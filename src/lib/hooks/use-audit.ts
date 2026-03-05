import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const auditKeys = {
  all: ['audit'] as const,
  lists: () => [...auditKeys.all, 'list'] as const,
  list: (params: Record<string, unknown>) => [...auditKeys.lists(), params] as const,
  entity: (entityType: string, entityId: string) => [...auditKeys.all, 'entity', entityType, entityId] as const,
};

export function useAuditLog(params: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: auditKeys.list(params),
    queryFn: () => api.audit.list(params),
    placeholderData: keepPreviousData,
  });
}

export function useEntityAudit(entityType: string, entityId: string) {
  return useQuery({
    queryKey: auditKeys.entity(entityType, entityId),
    queryFn: () => api.audit.forEntity(entityType, entityId),
    enabled: !!entityType && !!entityId,
  });
}
