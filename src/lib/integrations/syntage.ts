import { ApiError } from '@/lib/utils/errors';

const SYNTAGE_BASE = 'https://api.syntage.com';
const TIMEOUT = 30_000;
const MAX_RETRIES = 3;

async function syntageRequest(
  method: string,
  path: string,
  body?: unknown,
  retries = MAX_RETRIES
): Promise<unknown> {
  const apiKey = process.env.SYNTAGE_API_KEY;
  if (!apiKey) {
    throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Syntage API key no configurada', 422);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const res = await fetch(`${SYNTAGE_BASE}${path}`, {
      method,
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => 'Unknown error');
      if (retries > 0 && (res.status >= 500 || res.status === 429)) {
        const delay = Math.pow(2, MAX_RETRIES - retries) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        return syntageRequest(method, path, body, retries - 1);
      }
      throw new ApiError('SYNTAGE_ERROR', `Syntage error: ${errorText}`, 502);
    }

    return res.json();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if ((err as Error).name === 'AbortError') {
      if (retries > 0) {
        const delay = Math.pow(2, MAX_RETRIES - retries) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        return syntageRequest(method, path, body, retries - 1);
      }
      throw new ApiError('INTEGRATION_TIMEOUT', 'Timeout al consultar Syntage', 504);
    }
    throw new ApiError('SYNTAGE_ERROR', 'Error al comunicarse con Syntage', 502);
  } finally {
    clearTimeout(timeout);
  }
}

// --- Credentials ---
export async function createCredential(certificate: string, privateKey: string, password: string) {
  return syntageRequest('POST', '/credentials', {
    certificate,
    private_key: privateKey,
    password,
  });
}

export async function getCredential(credentialId: string) {
  return syntageRequest('GET', `/credentials/${credentialId}`);
}

// --- Extractions ---
export async function createExtraction(
  taxpayerId: string,
  extractor: string,
  options?: { dateFrom?: string; dateTo?: string }
) {
  return syntageRequest('POST', '/extractions', {
    extractor,
    taxpayer: `/taxpayers/${taxpayerId}`,
    options,
  });
}

export async function getExtraction(extractionId: string) {
  return syntageRequest('GET', `/extractions/${extractionId}`);
}

// --- Invoices ---
export async function getInvoices(
  taxpayerId: string,
  params?: {
    type?: string;
    dateFrom?: string;
    dateTo?: string;
    uuid?: string[];
    page?: number;
    limit?: number;
  }
) {
  const searchParams = new URLSearchParams();
  if (params?.type) searchParams.set('type', params.type);
  if (params?.dateFrom) searchParams.set('dateFrom', params.dateFrom);
  if (params?.dateTo) searchParams.set('dateTo', params.dateTo);
  if (params?.uuid) params.uuid.forEach(u => searchParams.append('uuid[]', u));
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.limit) searchParams.set('limit', String(params.limit));

  const query = searchParams.toString();
  return syntageRequest('GET', `/taxpayers/${taxpayerId}/invoices${query ? `?${query}` : ''}`);
}

export async function getInvoiceDetail(invoiceId: string) {
  return syntageRequest('GET', `/invoices/${invoiceId}`);
}

export async function getInvoiceCfdi(invoiceId: string, format: 'xml' | 'pdf' = 'xml') {
  const apiKey = process.env.SYNTAGE_API_KEY;
  if (!apiKey) throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Syntage no configurada', 422);

  const res = await fetch(`${SYNTAGE_BASE}/invoices/${invoiceId}/cfdi`, {
    headers: {
      'X-API-Key': apiKey,
      'Accept': format === 'pdf' ? 'application/pdf' : 'application/xml',
    },
  });

  if (!res.ok) throw new ApiError('SYNTAGE_ERROR', 'Error al descargar CFDI', 502);
  return res;
}

// --- Tax Status ---
export async function getTaxStatus(taxpayerId: string) {
  return syntageRequest('GET', `/taxpayers/${taxpayerId}/tax-status`);
}

// --- Tax Retentions ---
export async function getTaxRetentions(taxpayerId: string) {
  return syntageRequest('GET', `/taxpayers/${taxpayerId}/tax-retentions`);
}

// --- Tax Compliance ---
export async function getTaxCompliance(taxpayerId: string) {
  return syntageRequest('GET', `/taxpayers/${taxpayerId}/tax-compliance-checks`);
}

// --- Tax Returns ---
export async function getTaxReturns(taxpayerId: string) {
  return syntageRequest('GET', `/taxpayers/${taxpayerId}/tax-returns`);
}

// --- Webhooks ---
export async function registerWebhook(url: string, events: string[]) {
  return syntageRequest('POST', '/webhook-endpoints', { url, events });
}

// --- Schedulers ---
export async function createScheduler(taxpayerId: string, extractor: string, frequency: string) {
  return syntageRequest('POST', '/schedulers', {
    taxpayer: `/taxpayers/${taxpayerId}`,
    extractor,
    frequency,
  });
}

// --- Webhook Verification ---
export function verifySyntageWebhook(webhookSecret: string, headerSecret: string): boolean {
  return webhookSecret === headerSecret;
}
