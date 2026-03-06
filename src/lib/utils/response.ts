import { ApiError } from './errors';

interface SuccessResponse<T> {
  data: T;
  meta?: {
    total: number;
    page: number;
    limit: number;
  };
}

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export function successResponse<T>(data: T, status = 200): Response {
  const body: SuccessResponse<T> = { data };
  return Response.json(body, { status });
}

export function paginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
  status = 200
): Response {
  const body: SuccessResponse<T[]> = {
    data,
    meta: { total, page, limit },
  };
  return Response.json(body, { status });
}

export function errorResponse(error: ApiError): Response {
  const body: ErrorResponse = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details && { details: error.details }),
    },
  };
  return Response.json(body, { status: error.status });
}

export function handleError(err: unknown): Response {
  if (err instanceof ApiError) {
    return errorResponse(err);
  }

  console.error('Unhandled error:', err);
  return Response.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' } },
    { status: 500 }
  );
}

export function parsePaginationParams(url: URL): {
  page: number;
  limit: number;
  sort: string;
  search: string;
} {
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const rawLimit = parseInt(url.searchParams.get('limit') || '25', 10);
  const limit = Math.min(100, Math.max(1, rawLimit));
  const sort = url.searchParams.get('sort') || 'created_at:desc';
  const rawSearch = url.searchParams.get('search') || '';
  const search = sanitizeSearchParam(rawSearch);
  return { page, limit, sort, search };
}

/**
 * Strips characters that could manipulate PostgREST .or() filter expressions.
 */
function sanitizeSearchParam(value: string): string {
  return value.replace(/[,().\\]/g, '').trim().slice(0, 100);
}
