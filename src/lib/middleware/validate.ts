import { z } from 'zod';
import { AuthContext } from './auth';
import { ApiError } from '@/lib/utils/errors';

export interface ValidatedContext<T> extends AuthContext {
  body: T;
}

type ValidatedHandler<T> = (req: Request, ctx: ValidatedContext<T>) => Promise<Response>;

export function withValidation<T extends z.ZodType>(
  schema: T,
  handler: ValidatedHandler<z.infer<T>>
): (req: Request, ctx: AuthContext) => Promise<Response> {
  return async (req: Request, ctx: AuthContext): Promise<Response> => {
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      throw new ApiError('VALIDATION_ERROR', 'Request body debe ser JSON valido', 400);
    }

    const result = schema.safeParse(rawBody);
    if (!result.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of result.error.issues) {
        const path = issue.path.join('.');
        if (!fieldErrors[path]) fieldErrors[path] = [];
        fieldErrors[path].push(issue.message);
      }
      throw new ApiError('VALIDATION_ERROR', 'Error de validacion', 400, fieldErrors);
    }

    const validatedCtx: ValidatedContext<z.infer<T>> = {
      ...ctx,
      body: result.data,
    };

    return handler(req, validatedCtx);
  };
}

export function withQueryValidation<T extends z.ZodType>(
  schema: T,
  handler: (req: Request, ctx: AuthContext, query: z.infer<T>) => Promise<Response>
): (req: Request, ctx: AuthContext) => Promise<Response> {
  return async (req: Request, ctx: AuthContext): Promise<Response> => {
    const url = new URL(req.url);
    const params: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      params[key] = value;
    });

    const result = schema.safeParse(params);
    if (!result.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of result.error.issues) {
        const path = issue.path.join('.');
        if (!fieldErrors[path]) fieldErrors[path] = [];
        fieldErrors[path].push(issue.message);
      }
      throw new ApiError('VALIDATION_ERROR', 'Error en parametros de query', 400, fieldErrors);
    }

    return handler(req, ctx, result.data);
  };
}
