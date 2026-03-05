import { handleError } from '@/lib/utils/response';
import { checkRateLimit } from './rate-limit';

type RouteHandler = (
  req: Request,
  context: { params: Promise<Record<string, string>> }
) => Promise<Response>;

/**
 * Wraps a route handler with error handling and rate limiting.
 * Use this for all API routes.
 */
export function createHandler(
  handler: (req: Request, params: Record<string, string>) => Promise<Response>,
  options?: { rateLimit?: 'auth' | 'read' | 'write' | 'batch'; public?: boolean }
): RouteHandler {
  return async (req, context) => {
    try {
      const params = await context.params;
      if (options?.rateLimit) {
        checkRateLimit(req, options.rateLimit);
      }
      return await handler(req, params);
    } catch (err) {
      return handleError(err);
    }
  };
}
