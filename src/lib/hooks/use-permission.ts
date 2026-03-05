import { useAuthStore } from '@/lib/store';
import { hasPermission, type Permission } from '@/lib/rbac';

export function usePermission(perm: Permission): boolean {
  const role = useAuthStore((s) => s.role);
  return hasPermission(role, perm);
}
