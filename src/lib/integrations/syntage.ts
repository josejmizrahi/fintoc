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

const rateLimitState: RateLimitState = { limit: 0, remaining: Infinity, resetAt: 0 };

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
  | 'invoice' | 'tax_return' | 'tax_status' | 'tax_compliance'
  | 'tax_retention' | 'electronic_accounting' | 'sat_certificate'
  | 'expense_receipt' | 'accounting_data';

export type EfosStatus = 'no_listed' | 'presumed' | 'definitive' | 'acquitted' | 'favorable_sentence';

export const EFOS_LABELS: Record<EfosStatus, string> = {
  'no_listed': 'No en lista 69-B',
  'presumed': 'Presunto (bajo investigación)',
  'acquitted': 'Desvirtuado',
  'definitive': 'Definitivo (empresa fantasma)',
  'favorable_sentence': 'Sentencia favorable',
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
  type: 'I' | 'E' | 'T' | 'N' | 'P';
  status: 'Vigente' | 'Cancelado';
  total: number;
  subtotal?: number;
  discount?: number;
  currency?: string;
  exchange_rate?: number;
  issued_at: string;
  certified_at?: string;
  cancelled_at?: string;
  issuer: {
    rfc: string;
    name?: string;
  };
  receiver: {
    rfc: string;
    name?: string;
  };
  efos_validation?: EfosStatus;
  payment_method?: string;
  payment_form?: string;
  cfdi_usage?: string;
  voucher_effect?: string;
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
function getApiKey(override?: string): string {
  const key = override || process.env.SYNTAGE_API_KEY;
  if (!key) {
    throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Syntage API key no configurada', 422);
  }
  return key;
}

function buildHeaders(options?: {
  pagination?: PaginationStyle;
  accept?: string;
  apiKey?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    'X-API-Key': getApiKey(options?.apiKey),
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
    apiKey?: string;
    baseUrl?: string;
  }
): Promise<{ data: T; meta: SyntageRequestMeta }> {
  const retries = options?.retries ?? MAX_RETRIES;
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;

  await waitForRateLimit();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const base = options?.baseUrl || SYNTAGE_BASE_URL;
    const url = path.startsWith('http') ? path : `${base}${path}`;
    const res = await fetch(url, {
      method,
      headers: buildHeaders({ pagination: options?.pagination, accept: options?.accept, apiKey: options?.apiKey }),
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
 
export async function fetchAllPages<T>(
  path: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
 
export async function fetchAllCursor<T>(
  path: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  date_from?: string;
  date_to?: string;
  type?: 'issued' | 'received';
  file_format?: 'xml' | 'pdf' | 'both';
}

export async function createExtraction(
  entityId: string,
  extractor: Extractor,
  options?: CreateExtractionOptions
): Promise<ExtractionResult> {
  const body: Record<string, unknown> = {
    extractor,
    entity: `/entities/${entityId}`,
  };
  if (options) {
    const extractionOptions: Record<string, unknown> = {};
    if (options.date_from) extractionOptions.date_from = options.date_from;
    if (options.date_to) extractionOptions.date_to = options.date_to;
    if (options.type) extractionOptions.type = options.type;
    if (options.file_format) extractionOptions.file_format = options.file_format;
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
  entityId: string,
  options?: CreateExtractionOptions
): Promise<Record<Extractor, ExtractionResult>> {
  const extractors: Extractor[] = [
    'invoice', 'tax_return', 'tax_status',
    'tax_compliance', 'tax_retention',
  ];

  const results: Record<string, ExtractionResult> = {};
  for (const extractor of extractors) {
    try {
      results[extractor] = await createExtraction(entityId, extractor, options);
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
  date_from?: string;
  date_to?: string;
  uuid?: string[];
  status?: 'Vigente' | 'Cancelado';
  issuerRfc?: string;
  receiverRfc?: string;
}

export async function getInvoices(
  entityId: string,
  params?: InvoiceQueryParams
): Promise<SyntageInvoice[]> {
  const queryParams: Record<string, unknown> = {};
  if (params?.type) queryParams.type = params.type;
  if (params?.date_from) queryParams.date_from = params.date_from;
  if (params?.date_to) queryParams.date_to = params.date_to;
  if (params?.uuid) queryParams.uuid = params.uuid;
  if (params?.status) queryParams.status = params.status;
  if (params?.issuerRfc) queryParams['issuer.rfc'] = params.issuerRfc;
  if (params?.receiverRfc) queryParams['receiver.rfc'] = params.receiverRfc;
  if (params?.page) queryParams.page = params.page;
  if (params?.itemsPerPage) queryParams.itemsPerPage = params.itemsPerPage;
  if (params?.properties) queryParams.properties = params.properties;

  return fetchAllCursor<SyntageInvoice>(
    `/entities/${entityId}/invoices`,
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
  entityId: string,
  params?: Omit<InvoiceQueryParams, 'page' | 'itemsPerPage'> & { batchSize?: number }
): Promise<SyntageInvoice[]> {
  const queryParams: Record<string, unknown> = {
    itemsPerPage: params?.batchSize || DEFAULT_PAGE_SIZE,
  };
  if (params?.type) queryParams.type = params.type;
  if (params?.date_from) queryParams.date_from = params.date_from;
  if (params?.date_to) queryParams.date_to = params.date_to;
  if (params?.uuid) queryParams.uuid = params.uuid;
  if (params?.status) queryParams.status = params.status;

  return fetchAllCursor<SyntageInvoice>(
    `/entities/${entityId}/invoices`,
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
export async function getTaxStatus(entityId: string) {
  const { data } = await syntageRequest('GET', `/entities/${entityId}/tax-status`);
  return data;
}

// ---------------------------------------------------------------------------
// Tax Retentions
// ---------------------------------------------------------------------------
export async function getTaxRetentions(entityId: string, params?: SyntageListParams) {
  return fetchAllPages(`/entities/${entityId}/tax-retentions`, params);
}

// ---------------------------------------------------------------------------
// Tax Compliance
// ---------------------------------------------------------------------------
export async function getTaxCompliance(entityId: string) {
  const { data } = await syntageRequest('GET', `/entities/${entityId}/tax-compliance-checks`);
  return data;
}

// ---------------------------------------------------------------------------
// Tax Returns
// ---------------------------------------------------------------------------
export async function getTaxReturns(entityId: string, params?: SyntageListParams) {
  return fetchAllPages(`/entities/${entityId}/tax-returns`, params);
}

// ---------------------------------------------------------------------------
// SAT Certificates
// ---------------------------------------------------------------------------
export async function getSatCertificates(entityId: string) {
  const { data } = await syntageRequest('GET', `/entities/${entityId}/sat-certificates`);
  return data;
}

// ---------------------------------------------------------------------------
// Electronic Accounting
// ---------------------------------------------------------------------------
export async function getElectronicAccounting(entityId: string, params?: SyntageListParams) {
  return fetchAllPages(`/entities/${entityId}/electronic-accounting-records`, params);
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
  entityId: string,
  extractor: Extractor,
  frequency: string
) {
  const { data } = await syntageRequest('POST', '/schedulers', {
    body: {
      entity: `/entities/${entityId}`,
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
// EFOS Helpers — single canonical implementation (SAT 69-B / ValidacionEFOS)
// ---------------------------------------------------------------------------
export interface EfosResult {
  status: EfosStatus | null;
  label: string;
  isBlocked: boolean;  // 'definitive'
  isRisky: boolean;    // 'presumed'
  safe: boolean;       // 'no_listed', 'acquitted', 'favorable_sentence' or not listed
}

export function parseEfosStatus(status: string | undefined | null): EfosResult {
  if (status === undefined || status === null) {
    return { status: null, label: 'Sin información EFOS', isBlocked: false, isRisky: false, safe: true };
  }
  if (!(status in EFOS_LABELS)) {
    return { status: null, label: `Estado EFOS desconocido: ${status}`, isBlocked: false, isRisky: false, safe: true };
  }
  const efosStatus = status as EfosStatus;
  const isBlocked = efosStatus === 'definitive';
  const isRisky = efosStatus === 'presumed';
  const safe = !isBlocked && !isRisky;
  return {
    status: efosStatus,
    label: EFOS_LABELS[efosStatus],
    isBlocked,
    isRisky,
    safe,
  };
}

/**
 * Map Syntage invoice type to our internal type
 */
export function mapInvoiceType(syntageType: string): 'payable' | 'receivable' {
  switch (syntageType) {
    case 'I': return 'receivable';  // Ingreso
    case 'E': return 'payable';     // Egreso
    case 'P': return 'payable';     // Pago
    default: return 'payable';
  }
}

/**
 * Map Syntage invoice status to SAT status
 */
export function mapSatStatus(syntageStatus: string): string {
  switch (syntageStatus) {
    case 'Vigente': return 'vigente';
    case 'Cancelado': return 'cancelado';
    default: return syntageStatus;
  }
}

// ---------------------------------------------------------------------------
// createSyntageClient — compatibility layer for sat/syntage route (unified client)
// ---------------------------------------------------------------------------
export type SyntageClientConfig = { syntageApiKey: string; syntageEnvironment?: string };

export function createSyntageClient(config: SyntageClientConfig | Record<string, string>): {
  testConnection(): Promise<{ ok: boolean; taxpayers: number; credentials: number; error?: string }>;
  listCredentials(params?: Record<string, string>): Promise<{ 'hydra:member': unknown[]; 'hydra:totalItems': number }>;
  getCredential(id: string): Promise<unknown>;
  listTaxpayers(params?: Record<string, string>): Promise<{ 'hydra:member': unknown[]; 'hydra:totalItems': number }>;
  listInvoices(taxpayerId: string, params?: Record<string, string>): Promise<{ 'hydra:member': unknown[]; 'hydra:totalItems': number; 'hydra:view'?: unknown }>;
  getInvoice(id: string): Promise<unknown>;
  getInvoiceCfdi(id: string): Promise<Response>;
  getInvoiceLineItems(invoiceId: string): Promise<{ 'hydra:member': unknown[]; 'hydra:totalItems': number }>;
  getInvoicePayments(invoiceId: string): Promise<{ 'hydra:member': unknown[]; 'hydra:totalItems': number }>;
  listTaxReturns(taxpayerId: string): Promise<{ 'hydra:member': unknown[]; 'hydra:totalItems': number }>;
  getTaxReturn(id: string): Promise<unknown>;
  getTaxReturnData(id: string): Promise<unknown>;
  listTaxComplianceChecks(taxpayerId: string): Promise<{ 'hydra:member': unknown[]; 'hydra:totalItems': number }>;
  listTaxStatus(taxpayerId: string): Promise<{ 'hydra:member': unknown[]; 'hydra:totalItems': number }>;
  listTaxRetentions(taxpayerId: string): Promise<{ 'hydra:member': unknown[]; 'hydra:totalItems': number }>;
  listCertificates(entityId: string): Promise<{ 'hydra:member': unknown[]; 'hydra:totalItems': number }>;
  listExtractions(): Promise<{ 'hydra:member': unknown[]; 'hydra:totalItems': number }>;
  getExtraction(id: string): Promise<unknown>;
  getBalanceSheet(taxpayerId: string): Promise<unknown>;
  getIncomeStatement(taxpayerId: string): Promise<unknown>;
  getCashFlow(insightId: string): Promise<unknown>;
  getFinancialRatios(insightId: string): Promise<unknown>;
  getScores(entityId: string): Promise<unknown>;
  listEvents(): Promise<{ 'hydra:member': unknown[]; 'hydra:totalItems': number }>;
  createCredential(rfc: string, password: string, certificate?: string, privateKey?: string): Promise<unknown>;
  deleteCredential(id: string): Promise<void>;
  revalidateCredential(id: string): Promise<unknown>;
  createExtraction(taxpayerId: string, extractor?: string, options?: unknown): Promise<unknown>;
  stopExtraction(extractionId: string): Promise<void>;
  createExport(params: { taxpayer: string; format: string }): Promise<unknown>;
  createWebhook(url: string, events: string[]): Promise<unknown>;
  createEntity(data: { rfc?: string; name?: string }): Promise<unknown>;
} {
  const apiKey = (config as SyntageClientConfig).syntageApiKey || (config as Record<string, string>).syntageApiKey;
  if (!apiKey) throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Falta la API Key de Syntage', 422);
  const baseUrl = (config as SyntageClientConfig).syntageEnvironment === 'sandbox' || (config as Record<string, string>).syntageEnvironment === 'sandbox'
    ? 'https://api.sandbox.syntage.com' : SYNTAGE_BASE_URL;
  const opts = { apiKey, baseUrl };

  const req = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const { data } = await syntageRequest<T>(method, path, { ...opts, body });
    return data;
  };

  return {
    async testConnection() {
      try {
        const [entities, credentials] = await Promise.all([
          req<{ 'hydra:totalItems': number }>('GET', '/entities'),
          req<{ 'hydra:totalItems': number }>('GET', '/credentials'),
        ]);
        return {
          ok: true,
          taxpayers: entities['hydra:totalItems'] ?? 0,
          credentials: credentials['hydra:totalItems'] ?? 0,
        };
      } catch (e) {
        return { ok: false, taxpayers: 0, credentials: 0, error: e instanceof Error ? e.message : 'Error de conexion' };
      }
    },
    listCredentials(params) {
      const qs = params && Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
      return req('GET', `/credentials${qs}`);
    },
    getCredential(id) {
      return req('GET', `/credentials/${id}`);
    },
    listTaxpayers(params) {
      const qs = params && Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
      return req('GET', `/entities${qs}`);
    },
    listInvoices(taxpayerId, params) {
      const qs = params && Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
      return req('GET', `/entities/${taxpayerId}/invoices${qs}`);
    },
    getInvoice(id) {
      return req('GET', `/invoices/${id}`);
    },
    async getInvoiceCfdi(id) {
      const url = `${baseUrl}/invoices/${id}/cfdi`;
      const res = await fetch(url, {
        headers: buildHeaders({ apiKey, accept: 'application/xml' }),
      });
      if (!res.ok) throw new ApiError('SYNTAGE_ERROR', `Error al descargar CFDI: ${res.status}`, 502);
      return res;
    },
    getInvoiceLineItems(invoiceId) {
      return req('GET', `/invoices/${invoiceId}/line-items`);
    },
    getInvoicePayments(invoiceId) {
      return req('GET', `/invoices/${invoiceId}/payments`);
    },
    listTaxReturns(taxpayerId) {
      return req('GET', `/entities/${taxpayerId}/tax-returns`);
    },
    getTaxReturn(id) {
      return req('GET', `/tax-returns/${id}`);
    },
    getTaxReturnData(id) {
      return req('GET', `/tax-returns/${id}/data`);
    },
    listTaxComplianceChecks(taxpayerId) {
      return req('GET', `/entities/${taxpayerId}/tax-compliance-checks`);
    },
    listTaxStatus(taxpayerId) {
      return req('GET', `/entities/${taxpayerId}/tax-status`);
    },
    listTaxRetentions(taxpayerId) {
      return req('GET', `/entities/${taxpayerId}/tax-retentions`);
    },
    listCertificates(entityId) {
      return req('GET', `/entities/${entityId}/sat-certificates`);
    },
    listExtractions() {
      return req('GET', '/extractions');
    },
    getExtraction(id) {
      return req('GET', `/extractions/${id}`);
    },
    getBalanceSheet(taxpayerId) {
      return req('GET', `/taxpayers/${taxpayerId}/insights/balance-sheet`);
    },
    getIncomeStatement(taxpayerId) {
      return req('GET', `/taxpayers/${taxpayerId}/insights/income-statement`);
    },
    getCashFlow(insightId) {
      return req('GET', `/insights/${insightId}/cash-flow`);
    },
    getFinancialRatios(insightId) {
      return req('GET', `/insights/${insightId}/ratios`);
    },
    getScores(entityId) {
      return req('GET', `/entities/${entityId}/scores`);
    },
    listEvents() {
      return req('GET', '/events');
    },
    createCredential(rfc, password, certificate?, privateKey?) {
      return req('POST', '/credentials', { rfc, password, certificate, privateKey });
    },
    async deleteCredential(id) {
      await syntageRequest('DELETE', `/credentials/${id}`, opts);
    },
    revalidateCredential(id) {
      return req('POST', `/credentials/${id}/revalidate`);
    },
    createExtraction(entityId, extractor = 'invoice', options?) {
      const body: Record<string, unknown> = { entity: `/entities/${entityId}`, extractor };
      if (options && typeof options === 'object' && !Array.isArray(options)) {
        body.options = options;
      }
      return req('POST', '/extractions', body);
    },
    async stopExtraction(extractionId) {
      await syntageRequest('POST', `/extractions/${extractionId}/cancel`, opts);
    },
    createExport(params) {
      return req('POST', '/exports', params);
    },
    createWebhook(url, events) {
      return req('POST', '/webhooks', { url, enabledEvents: events });
    },
    createEntity(data) {
      return req('POST', '/entities', data);
    },
  };
}
