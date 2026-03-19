import { AuthContext } from './auth';
import { ApiError } from '@/lib/utils/errors';
import { hasPermission, type Permission } from '@/lib/rbac';

type RbacHandler = (req: Request, ctx: AuthContext) => Promise<Response>;

export function withRbac(permission: Permission | string, handler: RbacHandler): RbacHandler {
  return async (req: Request, ctx: AuthContext): Promise<Response> => {
    if (!hasPermission(ctx.role, permission)) {
      throw new ApiError(
        'FORBIDDEN',
        `Rol '${ctx.role}' no tiene permiso '${permission}'`,
        403
      );
    }
    return handler(req, ctx);
  };
}
