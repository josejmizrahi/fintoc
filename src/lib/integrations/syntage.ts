import { ApiError } from '@/lib/utils/errors';

// ---------------------------------------------------------------------------
// Syntage API Client — Professional integration following Syntage docs
// https://docs.syntage.com/
// ---------------------------------------------------------------------------

const SYNTAGE_BASE_URL = process.env.SYNTAGE_BASE_URL || 'https://api.syntage.com';
const API_VERSION = '2020-06-28';
const DEFAULT_TIMEOUT = 30_000;
const MAX_RETRIES = 3;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 1000;

// ---------------------------------------------------------------------------
// Rate-limit state (per-process singleton)
// ---------------------------------------------------------------------------
interface RateLimitState {
  limit: number;
  remaining: number;
  resetAt: number; // epoch seconds
}

let rateLimitState: RateLimitState = { limit: 0, remaining: Infinity, resetAt: 0 };

export function getRateLimitState(): Readonly<RateLimitState> {
  return { ...rateLimitState };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type ExtractionStatus =
  | 'pending' | 'waiting' | 'running' | 'finished'
  | 'failed' | 'stopping' | 'stopped' | 'cancelled';

export type CredentialStatus = 'pending' | 'valid' | 'invalid' | 'deactivated' | 'error';

export type Extractor =
  | 'invoices' | 'tax_returns' | 'tax_status' | 'tax_compliance_checks'
  | 'tax_retentions' | 'electronic_accounting' | 'sat_certificates'
  | 'expense_receipts' | 'accounting_data';

export type EfosCode = 200 | 201 | 202 | 203 | 204;

export const EFOS_LABELS: Record<EfosCode, string> = {
  200: 'No en lista 69-B',
  201: 'Presunto (bajo investigación)',
  202: 'Desvirtuado',
  203: 'Definitivo (empresa fantasma)',
  204: 'Sentencia favorable',
};

export type PaginationStyle = 'offset' | 'cursor';

export interface SyntageListParams {
  page?: number;
  itemsPerPage?: number;
  properties?: string[];
}

export interface SyntageCursorParams {
  cursor?: string;
  itemsPerPage?: number;
  properties?: string[];
}

export interface SyntageResponse<T = unknown> {
  'hydra:member'?: T[];
  'hydra:totalItems'?: number;
  'hydra:view'?: {
    'hydra:next'?: string;
    'hydra:previous'?: string;
    'hydra:first'?: string;
    'hydra:last'?: string;
  };
  [key: string]: unknown;
}

export interface ExtractionResult {
  id: string;
  status: ExtractionStatus;
  extractor: Extractor;
  recordsFound?: number;
  error?: string;
  errorCode?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CredentialResult {
  id: string;
  status: CredentialStatus;
  taxpayerId?: string;
  type?: string;
  createdAt?: string;
}

export interface SyntageInvoice {
  id: string;
  uuid: string;
  type: 'ingreso' | 'egreso' | 'traslado' | 'nomina' | 'pago';
  status: 'active' | 'cancelled';
  total: number;
  subtotal?: number;
  discount?: number;
  currency?: string;
  exchangeRate?: number;
  issuedAt: string;
  certifiedAt?: string;
  cancelledAt?: string;
  issuerRfc: string;
  issuerName?: string;
  receiverRfc: string;
  receiverName?: string;
  efosValidation?: EfosCode;
  paymentMethod?: string;
  paymentForm?: string;
  cfdiUsage?: string;
  voucherEffect?: string;
  [key: string]: unknown;
}

export interface SyntageRequestMeta {
  requestId: string | null;
  rateLimitRemaining: number;
  rateLimitReset: number;
  statusCode: number;
}

// ---------------------------------------------------------------------------
// Extraction error classification
// ---------------------------------------------------------------------------
export type ExtractionErrorCode =
  | 'invalid_credentials' | 'login_failed' | 'unrecoverable'
  | 'sat_unavailable' | 'internal_error' | 'undefined';

export function isRetryableExtractionError(code: ExtractionErrorCode): boolean {
  return code === 'sat_unavailable' || code === 'internal_error';
}

// ---------------------------------------------------------------------------
// Core HTTP client
// ---------------------------------------------------------------------------
function getApiKey(): string {
  const key = process.env.SYNTAGE_API_KEY;
  if (!key) {
    throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Syntage API key no configurada', 422);
  }
  return key;
}

function buildHeaders(options?: {
  pagination?: PaginationStyle;
  accept?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    'X-API-Key': getApiKey(),
    'Content-Type': 'application/json',
    'Accept-Version': API_VERSION,
    'Accept': options?.accept || 'application/ld+json',
  };
  if (options?.pagination === 'cursor') {
    headers['X-Pagination-Style'] = 'cursor';
  }
  return headers;
}

function updateRateLimitState(headers: Headers): void {
  const limit = headers.get('x-ratelimit-limit');
  const remaining = headers.get('x-ratelimit-remaining');
  const reset = headers.get('x-ratelimit-reset');

  if (limit) rateLimitState.limit = parseInt(limit, 10);
  if (remaining) rateLimitState.remaining = parseInt(remaining, 10);
  if (reset) rateLimitState.resetAt = parseInt(reset, 10);
}

function extractRequestId(headers: Headers): string | null {
  return headers.get('x-request-id');
}

async function waitForRateLimit(): Promise<void> {
  if (rateLimitState.remaining <= 0) {
    const now = Math.floor(Date.now() / 1000);
    const waitMs = Math.max(0, (rateLimitState.resetAt - now) * 1000) + 100;
    if (waitMs > 0 && waitMs < 60_000) {
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }
}

async function syntageRequest<T = unknown>(
  method: string,
  path: string,
  options?: {
    body?: unknown;
    pagination?: PaginationStyle;
    accept?: string;
    timeout?: number;
    retries?: number;
  }
): Promise<{ data: T; meta: SyntageRequestMeta }> {
  const retries = options?.retries ?? MAX_RETRIES;
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;

  await waitForRateLimit();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const url = path.startsWith('http') ? path : `${SYNTAGE_BASE_URL}${path}`;
    const res = await fetch(url, {
      method,
      headers: buildHeaders({ pagination: options?.pagination, accept: options?.accept }),
      body: options?.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    updateRateLimitState(res.headers);
    const requestId = extractRequestId(res.headers);

    if (!res.ok) {
      const errorText = await res.text().catch(() => 'Unknown error');

      // Retry on 429 (rate limit) or 5xx (server error)
      if (retries > 0 && (res.status >= 500 || res.status === 429)) {
        const backoff = res.status === 429
          ? Math.max(1000, (rateLimitState.resetAt - Math.floor(Date.now() / 1000)) * 1000)
          : Math.pow(2, MAX_RETRIES - retries) * 1000;
        await new Promise(resolve => setTimeout(resolve, Math.min(backoff, 30_000)));
        return syntageRequest(method, path, { ...options, retries: retries - 1 });
      }

      throw new ApiError('SYNTAGE_ERROR', `Syntage ${res.status}: ${errorText}`, 502, {
        statusCode: res.status,
        requestId,
        path,
      });
    }

    const data = await res.json() as T;
    return {
      data,
      meta: {
        requestId,
        rateLimitRemaining: rateLimitState.remaining,
        rateLimitReset: rateLimitState.resetAt,
        statusCode: res.status,
      },
    };
  } catch (err) {
    if (err instanceof ApiError) throw err;

    if ((err as Error).name === 'AbortError') {
      if (retries > 0) {
        const backoff = Math.pow(2, MAX_RETRIES - retries) * 1000;
        await new Promise(resolve => setTimeout(resolve, backoff));
        return syntageRequest(method, path, { ...options, retries: retries - 1 });
      }
      throw new ApiError('INTEGRATION_TIMEOUT', 'Timeout al consultar Syntage', 504, { path });
    }

    if (retries > 0) {
      const backoff = Math.pow(2, MAX_RETRIES - retries) * 1000;
      await new Promise(resolve => setTimeout(resolve, backoff));
      return syntageRequest(method, path, { ...options, retries: retries - 1 });
    }

    throw new ApiError('SYNTAGE_ERROR', `Error de red al comunicarse con Syntage: ${(err as Error).message}`, 502);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Pagination helpers
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildQueryString(params?: Record<string, any>): string {
  if (!params) return '';
  const sp = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (key === 'itemsPerPage') {
      sp.set('itemsPerPage', String(Math.min(Number(value), MAX_PAGE_SIZE)));
    } else if (key === 'properties' && Array.isArray(value)) {
      (value as string[]).forEach((p: string) => sp.append('properties[]', p));
    } else if (Array.isArray(value)) {
      (value as unknown[]).forEach(v => sp.append(`${key}[]`, String(v)));
    } else {
      sp.set(key, String(value));
    }
  }

  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Fetch all pages using offset-based pagination.
 * Returns all items accumulated across pages.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAllPages<T>(
  path: string,
  params?: Record<string, any>,
  maxPages = 50
): Promise<T[]> {
  const allItems: T[] = [];
  let currentPage = params?.page || 1;
  const pageSize = params?.itemsPerPage || DEFAULT_PAGE_SIZE;

  for (let i = 0; i < maxPages; i++) {
    const queryParams = { ...params, page: currentPage, itemsPerPage: pageSize };
    const qs = buildQueryString(queryParams);
    const { data: pageData }: { data: SyntageResponse<T> } = await syntageRequest('GET', `${path}${qs}`);

    const items: T[] = pageData['hydra:member'] || [];
    allItems.push(...items);

    // Check if there are more pages
    const totalItems = pageData['hydra:totalItems'] || 0;
    if (allItems.length >= totalItems || items.length < (pageSize as number)) break;
    currentPage = (currentPage as number) + 1;
  }

  return allItems;
}

/**
 * Fetch all items using cursor-based pagination (recommended for large datasets).
 * Supported on: invoices, line-items, payments.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAllCursor<T>(
  path: string,
  params?: Record<string, any>,
  maxPages = 100
): Promise<T[]> {
  const allItems: T[] = [];
  let nextUrl: string | undefined = `${path}${buildQueryString(params)}`;

  for (let i = 0; i < maxPages && nextUrl; i++) {
    const { data: responseData }: { data: SyntageResponse<T> } = await syntageRequest('GET', nextUrl, {
      pagination: 'cursor',
    });

    const items: T[] = responseData['hydra:member'] || [];
    allItems.push(...items);

    nextUrl = responseData['hydra:view']?.['hydra:next'] || undefined;
  }

  return allItems;
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------
export async function createCredential(
  certificate: string,
  privateKey: string,
  password: string
): Promise<CredentialResult> {
  const { data } = await syntageRequest<CredentialResult>('POST', '/credentials', {
    body: { certificate, private_key: privateKey, password },
  });
  return data;
}

export async function getCredential(credentialId: string): Promise<CredentialResult> {
  const { data } = await syntageRequest<CredentialResult>('GET', `/credentials/${credentialId}`);
  return data;
}

export async function listCredentials(): Promise<CredentialResult[]> {
  return fetchAllPages<CredentialResult>('/credentials');
}

export async function deleteCredential(credentialId: string): Promise<void> {
  await syntageRequest('DELETE', `/credentials/${credentialId}`);
}

// ---------------------------------------------------------------------------
// Extractions
// ---------------------------------------------------------------------------
export interface CreateExtractionOptions {
  dateFrom?: string;
  dateTo?: string;
  type?: 'issued' | 'received';
  fileFormat?: 'xml' | 'pdf' | 'both';
}

export async function createExtraction(
  taxpayerId: string,
  extractor: Extractor,
  options?: CreateExtractionOptions
): Promise<ExtractionResult> {
  const body: Record<string, unknown> = {
    extractor,
    taxpayer: `/taxpayers/${taxpayerId}`,
  };
  if (options) {
    const extractionOptions: Record<string, unknown> = {};
    if (options.dateFrom) extractionOptions.dateFrom = options.dateFrom;
    if (options.dateTo) extractionOptions.dateTo = options.dateTo;
    if (options.type) extractionOptions.type = options.type;
    if (options.fileFormat) extractionOptions.fileFormat = options.fileFormat;
    if (Object.keys(extractionOptions).length > 0) body.options = extractionOptions;
  }
  const { data } = await syntageRequest<ExtractionResult>('POST', '/extractions', { body });
  return data;
}

export async function getExtraction(extractionId: string): Promise<ExtractionResult> {
  const { data } = await syntageRequest<ExtractionResult>('GET', `/extractions/${extractionId}`);
  return data;
}

export async function listExtractions(
  params?: SyntageListParams & { status?: ExtractionStatus; extractor?: Extractor }
): Promise<ExtractionResult[]> {
  return fetchAllPages<ExtractionResult>('/extractions', params);
}

export async function cancelExtraction(extractionId: string): Promise<ExtractionResult> {
  const { data } = await syntageRequest<ExtractionResult>('PUT', `/extractions/${extractionId}`, {
    body: { status: 'stopping' },
  });
  return data;
}

/**
 * Create a full extraction suite for a taxpayer: invoices, tax_returns, tax_status, etc.
 * Returns extraction IDs for each extractor.
 */
export async function createFullExtraction(
  taxpayerId: string,
  options?: CreateExtractionOptions
): Promise<Record<Extractor, ExtractionResult>> {
  const extractors: Extractor[] = [
    'invoices', 'tax_returns', 'tax_status',
    'tax_compliance_checks', 'tax_retentions',
  ];

  const results: Record<string, ExtractionResult> = {};
  for (const extractor of extractors) {
    try {
      results[extractor] = await createExtraction(taxpayerId, extractor, options);
    } catch (err) {
      // Log but continue — partial extraction is better than none
      results[extractor] = {
        id: '',
        status: 'failed',
        extractor,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }
  return results as Record<Extractor, ExtractionResult>;
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------
export interface InvoiceQueryParams extends SyntageListParams {
  type?: 'issued' | 'received';
  dateFrom?: string;
  dateTo?: string;
  uuid?: string[];
  status?: 'active' | 'cancelled';
  issuerRfc?: string;
  receiverRfc?: string;
}

export async function getInvoices(
  taxpayerId: string,
  params?: InvoiceQueryParams
): Promise<SyntageInvoice[]> {
  const queryParams: Record<string, unknown> = {};
  if (params?.type) queryParams.type = params.type;
  if (params?.dateFrom) queryParams.dateFrom = params.dateFrom;
  if (params?.dateTo) queryParams.dateTo = params.dateTo;
  if (params?.uuid) queryParams.uuid = params.uuid;
  if (params?.status) queryParams.status = params.status;
  if (params?.issuerRfc) queryParams['issuer.rfc'] = params.issuerRfc;
  if (params?.receiverRfc) queryParams['receiver.rfc'] = params.receiverRfc;
  if (params?.page) queryParams.page = params.page;
  if (params?.itemsPerPage) queryParams.itemsPerPage = params.itemsPerPage;
  if (params?.properties) queryParams.properties = params.properties;

  return fetchAllCursor<SyntageInvoice>(
    `/taxpayers/${taxpayerId}/invoices`,
    queryParams as SyntageCursorParams & Record<string, unknown>
  );
}

export async function getInvoiceDetail(invoiceId: string): Promise<SyntageInvoice> {
  const { data } = await syntageRequest<SyntageInvoice>('GET', `/invoices/${invoiceId}`);
  return data;
}

export async function getInvoiceCfdi(
  invoiceId: string,
  format: 'xml' | 'pdf' = 'xml'
): Promise<Response> {
  const url = `${SYNTAGE_BASE_URL}/invoices/${invoiceId}/cfdi`;
  const res = await fetch(url, {
    headers: {
      'X-API-Key': getApiKey(),
      'Accept': format === 'pdf' ? 'application/pdf' : 'application/xml',
      'Accept-Version': API_VERSION,
    },
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Unknown error');
    throw new ApiError('SYNTAGE_ERROR', `Error al descargar CFDI: ${errorText}`, 502);
  }
  return res;
}

/**
 * Fetch all invoices with cursor pagination — ideal for large-scale data extraction.
 */
export async function getAllInvoices(
  taxpayerId: string,
  params?: Omit<InvoiceQueryParams, 'page' | 'itemsPerPage'> & { batchSize?: number }
): Promise<SyntageInvoice[]> {
  const queryParams: Record<string, unknown> = {
    itemsPerPage: params?.batchSize || DEFAULT_PAGE_SIZE,
  };
  if (params?.type) queryParams.type = params.type;
  if (params?.dateFrom) queryParams.dateFrom = params.dateFrom;
  if (params?.dateTo) queryParams.dateTo = params.dateTo;
  if (params?.uuid) queryParams.uuid = params.uuid;
  if (params?.status) queryParams.status = params.status;

  return fetchAllCursor<SyntageInvoice>(
    `/taxpayers/${taxpayerId}/invoices`,
    queryParams as SyntageCursorParams & Record<string, unknown>
  );
}

// ---------------------------------------------------------------------------
// Invoice Line Items
// ---------------------------------------------------------------------------
export async function getInvoiceLineItems(
  invoiceId: string,
  params?: SyntageListParams
): Promise<unknown[]> {
  return fetchAllCursor(`/invoices/${invoiceId}/line-items`, params as SyntageCursorParams & Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Invoice Payments (complementos de pago)
// ---------------------------------------------------------------------------
export async function getInvoicePayments(
  invoiceId: string,
  params?: SyntageListParams
): Promise<unknown[]> {
  return fetchAllCursor(`/invoices/${invoiceId}/payments`, params as SyntageCursorParams & Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Tax Status
// ---------------------------------------------------------------------------
export async function getTaxStatus(taxpayerId: string) {
  const { data } = await syntageRequest('GET', `/taxpayers/${taxpayerId}/tax-status`);
  return data;
}

// ---------------------------------------------------------------------------
// Tax Retentions
// ---------------------------------------------------------------------------
export async function getTaxRetentions(taxpayerId: string, params?: SyntageListParams) {
  return fetchAllPages(`/taxpayers/${taxpayerId}/tax-retentions`, params);
}

// ---------------------------------------------------------------------------
// Tax Compliance
// ---------------------------------------------------------------------------
export async function getTaxCompliance(taxpayerId: string) {
  const { data } = await syntageRequest('GET', `/taxpayers/${taxpayerId}/tax-compliance-checks`);
  return data;
}

// ---------------------------------------------------------------------------
// Tax Returns
// ---------------------------------------------------------------------------
export async function getTaxReturns(taxpayerId: string, params?: SyntageListParams) {
  return fetchAllPages(`/taxpayers/${taxpayerId}/tax-returns`, params);
}

// ---------------------------------------------------------------------------
// SAT Certificates
// ---------------------------------------------------------------------------
export async function getSatCertificates(taxpayerId: string) {
  const { data } = await syntageRequest('GET', `/taxpayers/${taxpayerId}/sat-certificates`);
  return data;
}

// ---------------------------------------------------------------------------
// Electronic Accounting
// ---------------------------------------------------------------------------
export async function getElectronicAccounting(taxpayerId: string, params?: SyntageListParams) {
  return fetchAllPages(`/taxpayers/${taxpayerId}/electronic-accounting-records`, params);
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------
export async function registerWebhook(url: string, events: string[]) {
  const { data } = await syntageRequest('POST', '/webhook-endpoints', {
    body: { url, events },
  });
  return data;
}

export async function listWebhooks() {
  return fetchAllPages('/webhook-endpoints');
}

export async function deleteWebhook(webhookId: string) {
  await syntageRequest('DELETE', `/webhook-endpoints/${webhookId}`);
}

// ---------------------------------------------------------------------------
// Schedulers
// ---------------------------------------------------------------------------
export async function createScheduler(
  taxpayerId: string,
  extractor: Extractor,
  frequency: string
) {
  const { data } = await syntageRequest('POST', '/schedulers', {
    body: {
      taxpayer: `/taxpayers/${taxpayerId}`,
      extractor,
      frequency,
    },
  });
  return data;
}

export async function listSchedulers(params?: SyntageListParams) {
  return fetchAllPages('/schedulers', params);
}

export async function deleteScheduler(schedulerId: string) {
  await syntageRequest('DELETE', `/schedulers/${schedulerId}`);
}

// ---------------------------------------------------------------------------
// Webhook Verification
// ---------------------------------------------------------------------------
export function verifySyntageWebhook(webhookSecret: string, headerSecret: string): boolean {
  if (!webhookSecret || !headerSecret) return false;
  // Constant-time comparison to prevent timing attacks
  if (webhookSecret.length !== headerSecret.length) return false;
  let mismatch = 0;
  for (let i = 0; i < webhookSecret.length; i++) {
    mismatch |= webhookSecret.charCodeAt(i) ^ headerSecret.charCodeAt(i);
  }
  return mismatch === 0;
}

// ---------------------------------------------------------------------------
// EFOS Helpers
// ---------------------------------------------------------------------------
export function parseEfosCode(code: number | string | undefined): {
  code: EfosCode | null;
  label: string;
  isBlocked: boolean;
  isRisky: boolean;
} {
  if (code === undefined || code === null) {
    return { code: null, label: 'Sin información EFOS', isBlocked: false, isRisky: false };
  }
  const numCode = typeof code === 'string' ? parseInt(code, 10) : code;
  if (!(numCode in EFOS_LABELS)) {
    return { code: null, label: `Código EFOS desconocido: ${code}`, isBlocked: false, isRisky: false };
  }
  const efosCode = numCode as EfosCode;
  return {
    code: efosCode,
    label: EFOS_LABELS[efosCode],
    isBlocked: efosCode === 203,     // Definitivo blocks payments
    isRisky: efosCode === 201,       // Presunto is risky but not blocking
  };
}

/**
 * Map Syntage invoice type to our internal type
 */
export function mapInvoiceType(syntageType: string): 'payable' | 'receivable' {
  switch (syntageType) {
    case 'ingreso': return 'receivable';
    case 'egreso': return 'payable';
    case 'pago': return 'payable';
    default: return 'payable';
  }
}

/**
 * Map Syntage invoice status to SAT status
 */
export function mapSatStatus(syntageStatus: string): string {
  switch (syntageStatus) {
    case 'active': return 'vigente';
    case 'cancelled': return 'cancelado';
    default: return syntageStatus;
  }
}
