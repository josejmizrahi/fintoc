/**
 * Syntage API Client — Complete integration (sat.ws / api.syntage.com)
 *
 * Full SAT data access via Syntage REST API:
 * - Credentials: Link SAT e.FIRMA / CIEC credentials
 * - Extractions: Async jobs to pull CFDIs, tax returns, compliance, etc.
 * - Invoices: Browse, filter, download CFDI XML/PDF, line items, payments
 * - Tax Returns: Annual (declaracion anual) and monthly (provisionales)
 * - Tax Compliance: Opinion de cumplimiento
 * - Tax Status: Constancia de situacion fiscal
 * - Tax Retentions: Retenciones e informacion de pagos
 * - Insights: Balance sheet, income statement, cash flow, ratios, scores
 * - Certificates: e.FIRMA / CSD certificates
 * - Exports: CSV/XLSX data exports
 * - Webhooks: Real-time event notifications
 * - Entities: Organization/person management
 * - Background Checks: KYC/AML checks
 */

import { withRetry } from "./retry";

// ── Config ──

const SYNTAGE_API = "https://api.syntage.com";
const SYNTAGE_SANDBOX = "https://api.sandbox.syntage.com";
const API_VERSION = "2020-06-28";

// ── Types ──

export interface SyntageConfig {
  apiKey: string;
  sandbox?: boolean;
}

export interface SyntageCollection<T> {
  "hydra:member": T[];
  "hydra:totalItems": number;
  "hydra:view"?: {
    "hydra:next"?: string;
    "hydra:previous"?: string;
    "hydra:first"?: string;
    "hydra:last"?: string;
  };
}

// Credentials
export interface SyntageCredential {
  "@id": string;
  id: string;
  rfc: string;
  status: "pending" | "valid" | "invalid" | "deactivated" | "error";
  taxpayer?: string;
  createdAt: string;
  updatedAt: string;
}

// Entities
export interface SyntageEntity {
  "@id": string;
  id: string;
  rfc?: string;
  name?: string;
  type?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

// Taxpayers
export interface SyntageTaxpayer {
  "@id": string;
  id: string;
  rfc: string;
  name?: string;
  createdAt: string;
}

// Extractions
export type ExtractionExtractor =
  | "invoice" | "annual_tax_return" | "monthly_tax_return"
  | "electronic_accounting" | "tax_status" | "tax_compliance"
  | "tax_retention" | "rpc" | "buro_de_credito_report" | "bil";

export type ExtractionStatus =
  | "pending" | "waiting" | "running" | "finished"
  | "failed" | "stopping" | "stopped" | "cancelled";

export interface ExtractionOptions {
  period?: { from: string; to: string };
  issued?: boolean;
  received?: boolean;
}

export interface SyntageExtraction {
  "@id": string;
  id: string;
  status: ExtractionStatus;
  extractor: ExtractionExtractor;
  taxpayer: string;
  options?: ExtractionOptions;
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
}

// Invoices
export interface SyntageInvoice {
  "@id": string;
  id: string;
  uuid: string;
  type: string; // I=Ingreso, E=Egreso, P=Pago, N=Nomina, T=Traslado
  status: string; // Vigente, Cancelado
  issuer: {
    rfc: string;
    name: string;
    fiscalRegime: string;
  };
  receiver: {
    rfc: string;
    name: string;
    fiscalRegime?: string;
    cfdiUse?: string;
  };
  total: number;
  subtotal: number;
  currency: string;
  exchangeRate?: number;
  paymentMethod?: string; // PUE, PPD
  paymentForm?: string;   // 01-99
  issuedAt: string;
  certifiedAt: string;
  cancelledAt?: string;
  blacklistStatus?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SyntageLineItem {
  "@id": string;
  id: string;
  description: string;
  quantity: number;
  unitValue: number;
  amount: number;
  discount?: number;
  productKey?: string;
  unitKey?: string;
  taxes?: Array<{
    type: string;
    rate: number;
    amount: number;
    base: number;
  }>;
}

export interface SyntagePayment {
  "@id": string;
  id: string;
  date: string;
  amount: number;
  currency: string;
  paymentForm: string;
  operationNumber?: string;
  relatedDocuments?: Array<{
    uuid: string;
    previousBalance: number;
    amountPaid: number;
    remainingBalance: number;
    installment: number;
  }>;
}

export interface SyntageBatchPayment {
  "@id": string;
  id: string;
  payments: SyntagePayment[];
  total: number;
  createdAt: string;
}

// Tax Returns
export interface SyntageTaxReturn {
  "@id": string;
  id: string;
  operationNumber: string;
  type: string;
  period?: string;
  year?: number;
  normalOrComplementary?: string;
  createdAt: string;
  updatedAt: string;
}

// Tax Compliance
export type ComplianceResult = "positive" | "negative" | "no_obligations" | "activity_suspended";

export interface SyntageTaxCompliance {
  "@id": string;
  id: string;
  result: ComplianceResult;
  validFrom?: string;
  validTo?: string;
  createdAt: string;
}

// Tax Status
export interface SyntageTaxStatus {
  "@id": string;
  id: string;
  rfc: string;
  name?: string;
  status?: string;
  fiscalRegime?: string;
  economicActivities?: Array<{ name: string; percentage: number }>;
  obligations?: Array<{ description: string; dueDate: string }>;
  createdAt: string;
}

// Tax Retentions
export interface SyntageTaxRetention {
  "@id": string;
  id: string;
  uuid: string;
  issuer: { rfc: string; name: string };
  receiver: { rfc: string; name: string };
  total: number;
  issuedAt: string;
  createdAt: string;
}

// Certificates
export interface SyntageCertificate {
  "@id": string;
  id: string;
  serialNumber: string;
  type: "efirma" | "csd";
  validFrom: string;
  validTo: string;
  createdAt: string;
}

// Insights
export interface SyntageInsightMetric {
  label: string;
  value: number;
  currency?: string;
}

export interface SyntageInsights {
  "@id"?: string;
  metrics?: SyntageInsightMetric[];
  [key: string]: unknown;
}

// Exports
export interface SyntageExport {
  "@id": string;
  id: string;
  status: "pending" | "running" | "finished";
  format: "csv" | "xlsx";
  downloadUrl?: string;
  createdAt: string;
}

// Webhooks
export interface SyntageWebhook {
  "@id": string;
  id: string;
  url: string;
  enabledEvents: string[];
  secret: string;
  createdAt: string;
}

// Background Checks
export interface SyntageBackgroundCheck {
  "@id": string;
  id: string;
  status: string;
  score?: number;
  createdAt: string;
}

// ── Client ──

export class SyntageClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: SyntageConfig) {
    this.baseUrl = config.sandbox ? SYNTAGE_SANDBOX : SYNTAGE_API;
    this.apiKey = config.apiKey;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return withRetry(async () => {
      const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
      const res = await fetch(url, {
        method,
        headers: {
          "X-API-Key": this.apiKey,
          "Accept": "application/ld+json",
          "Content-Type": "application/json",
          "Accept-Version": API_VERSION,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Syntage ${res.status}: ${text}`);
      }

      // DELETE returns no body
      if (res.status === 204) return undefined as T;
      return res.json() as Promise<T>;
    }, { maxRetries: 2, retryOn: (err) => {
      const msg = err instanceof Error ? err.message : "";
      return msg.includes("timeout") || msg.includes("429") || msg.includes("5");
    }});
  }

  private qs(params?: Record<string, string>): string {
    return params ? `?${new URLSearchParams(params)}` : "";
  }

  // ════════════════════════════════════════════════════════════
  // CREDENTIALS — Link SAT e.FIRMA / CIEC
  // ════════════════════════════════════════════════════════════

  async createCredential(rfc: string, password: string, certificate?: string, privateKey?: string): Promise<SyntageCredential> {
    return this.request("POST", "/credentials", {
      rfc, password,
      ...(certificate ? { certificate } : {}),
      ...(privateKey ? { privateKey } : {}),
    });
  }

  async listCredentials(params?: Record<string, string>): Promise<SyntageCollection<SyntageCredential>> {
    return this.request("GET", `/credentials${this.qs(params)}`);
  }

  async getCredential(id: string): Promise<SyntageCredential> {
    return this.request("GET", `/credentials/${id}`);
  }

  async deleteCredential(id: string): Promise<void> {
    return this.request("DELETE", `/credentials/${id}`);
  }

  async revalidateCredential(id: string): Promise<SyntageCredential> {
    return this.request("POST", `/credentials/${id}/revalidate`);
  }

  // ════════════════════════════════════════════════════════════
  // ENTITIES — Organization / Person management
  // ════════════════════════════════════════════════════════════

  async createEntity(data: { rfc?: string; name?: string }): Promise<SyntageEntity> {
    return this.request("POST", "/entities", data);
  }

  async listEntities(params?: Record<string, string>): Promise<SyntageCollection<SyntageEntity>> {
    return this.request("GET", `/entities${this.qs(params)}`);
  }

  async getEntity(id: string): Promise<SyntageEntity> {
    return this.request("GET", `/entities/${id}`);
  }

  async updateEntity(id: string, data: Partial<SyntageEntity>): Promise<SyntageEntity> {
    return this.request("PATCH", `/entities/${id}`, data);
  }

  async deleteEntity(id: string): Promise<void> {
    return this.request("DELETE", `/entities/${id}`);
  }

  // ════════════════════════════════════════════════════════════
  // TAXPAYERS
  // ════════════════════════════════════════════════════════════

  async listTaxpayers(params?: Record<string, string>): Promise<SyntageCollection<SyntageTaxpayer>> {
    return this.request("GET", `/taxpayers${this.qs(params)}`);
  }

  async getTaxpayer(id: string): Promise<SyntageTaxpayer> {
    return this.request("GET", `/taxpayers/${id}`);
  }

  // ════════════════════════════════════════════════════════════
  // EXTRACTIONS — Async SAT data pull
  // ════════════════════════════════════════════════════════════

  async createExtraction(
    taxpayerId: string,
    extractor: ExtractionExtractor = "invoice",
    options?: ExtractionOptions,
  ): Promise<SyntageExtraction> {
    return this.request("POST", "/extractions", {
      taxpayer: `/taxpayers/${taxpayerId}`,
      extractor,
      ...(options ? { options } : {}),
    });
  }

  async getExtraction(id: string): Promise<SyntageExtraction> {
    return this.request("GET", `/extractions/${id}`);
  }

  async listExtractions(params?: Record<string, string>): Promise<SyntageCollection<SyntageExtraction>> {
    return this.request("GET", `/extractions${this.qs(params)}`);
  }

  async stopExtraction(id: string): Promise<void> {
    return this.request("DELETE", `/extractions/${id}/stop`);
  }

  /** Poll extraction until terminal state. Returns final extraction. */
  async waitForExtraction(id: string, maxWaitMs = 300000, pollIntervalMs = 5000): Promise<SyntageExtraction> {
    const terminalStates: ExtractionStatus[] = ["finished", "failed", "stopped", "cancelled"];
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const extraction = await this.getExtraction(id);
      if (terminalStates.includes(extraction.status)) return extraction;
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
    throw new Error("Extraction timeout: exceeded max wait time");
  }

  // ════════════════════════════════════════════════════════════
  // INVOICES — CFDIs
  // ════════════════════════════════════════════════════════════

  async listInvoices(taxpayerId: string, params?: Record<string, string>): Promise<SyntageCollection<SyntageInvoice>> {
    return this.request("GET", `/taxpayers/${taxpayerId}/invoices${this.qs(params)}`);
  }

  async getInvoice(id: string): Promise<SyntageInvoice> {
    return this.request("GET", `/invoices/${id}`);
  }

  /** Download CFDI XML or PDF */
  async getInvoiceCfdi(id: string): Promise<{ xml?: string; downloadUrl?: string }> {
    return this.request("GET", `/invoices/${id}/cfdi`);
  }

  async getInvoiceLineItems(invoiceId: string, params?: Record<string, string>): Promise<SyntageCollection<SyntageLineItem>> {
    return this.request("GET", `/invoices/${invoiceId}/line-items${this.qs(params)}`);
  }

  async getInvoicePayments(invoiceId: string, params?: Record<string, string>): Promise<SyntageCollection<SyntagePayment>> {
    return this.request("GET", `/invoices/${invoiceId}/payments${this.qs(params)}`);
  }

  async getInvoiceBatchPayments(invoiceId: string): Promise<SyntageCollection<SyntageBatchPayment>> {
    return this.request("GET", `/invoices/${invoiceId}/batch-payments`);
  }

  async getInvoiceAppliedCreditNotes(invoiceId: string): Promise<SyntageCollection<SyntageInvoice>> {
    return this.request("GET", `/invoices/${invoiceId}/applied-credit-notes`);
  }

  async getInvoiceIssuedCreditNotes(invoiceId: string): Promise<SyntageCollection<SyntageInvoice>> {
    return this.request("GET", `/invoices/${invoiceId}/issued-credit-notes`);
  }

  /** Fetch all invoices with automatic pagination */
  async fetchAllInvoices(taxpayerId: string, params?: Record<string, string>): Promise<SyntageInvoice[]> {
    const all: SyntageInvoice[] = [];
    let nextUrl: string | undefined = `/taxpayers/${taxpayerId}/invoices?${new URLSearchParams({ itemsPerPage: "100", ...params })}`;
    while (nextUrl) {
      const page: SyntageCollection<SyntageInvoice> = await this.request("GET", nextUrl);
      all.push(...page["hydra:member"]);
      nextUrl = page["hydra:view"]?.["hydra:next"];
    }
    return all;
  }

  /** List line items across all invoices for a taxpayer */
  async listAllLineItems(taxpayerId: string, params?: Record<string, string>): Promise<SyntageCollection<SyntageLineItem>> {
    return this.request("GET", `/taxpayers/${taxpayerId}/invoices/line-items${this.qs(params)}`);
  }

  /** List payments across all invoices for a taxpayer */
  async listAllPayments(taxpayerId: string, params?: Record<string, string>): Promise<SyntageCollection<SyntagePayment>> {
    return this.request("GET", `/taxpayers/${taxpayerId}/invoices/payments${this.qs(params)}`);
  }

  /** List batch payments for a taxpayer */
  async listAllBatchPayments(taxpayerId: string, params?: Record<string, string>): Promise<SyntageCollection<SyntageBatchPayment>> {
    return this.request("GET", `/taxpayers/${taxpayerId}/batch-payments${this.qs(params)}`);
  }

  // ════════════════════════════════════════════════════════════
  // TAX RETURNS — Declaraciones fiscales
  // ════════════════════════════════════════════════════════════

  async listTaxReturns(taxpayerId: string, params?: Record<string, string>): Promise<SyntageCollection<SyntageTaxReturn>> {
    return this.request("GET", `/taxpayers/${taxpayerId}/tax-returns${this.qs(params)}`);
  }

  async getTaxReturn(id: string): Promise<SyntageTaxReturn> {
    return this.request("GET", `/tax-returns/${id}`);
  }

  /** Get financial data from tax return (balance sheet, income statement) */
  async getTaxReturnData(id: string): Promise<Record<string, unknown>> {
    return this.request("GET", `/tax-returns/${id}/data`);
  }

  async deleteTaxReturn(id: string): Promise<void> {
    return this.request("DELETE", `/tax-returns/${id}`);
  }

  // ════════════════════════════════════════════════════════════
  // TAX RETENTIONS — Retenciones e informacion de pagos
  // ════════════════════════════════════════════════════════════

  async listTaxRetentions(taxpayerId: string, params?: Record<string, string>): Promise<SyntageCollection<SyntageTaxRetention>> {
    return this.request("GET", `/taxpayers/${taxpayerId}/tax-retentions${this.qs(params)}`);
  }

  async getTaxRetention(id: string): Promise<SyntageTaxRetention> {
    return this.request("GET", `/tax-retentions/${id}`);
  }

  async getTaxRetentionCfdi(id: string): Promise<{ xml?: string; downloadUrl?: string }> {
    return this.request("GET", `/tax-retentions/${id}/cfdi`);
  }

  // ════════════════════════════════════════════════════════════
  // TAX COMPLIANCE — Opinion de cumplimiento
  // ════════════════════════════════════════════════════════════

  async listTaxComplianceChecks(taxpayerId: string, params?: Record<string, string>): Promise<SyntageCollection<SyntageTaxCompliance>> {
    return this.request("GET", `/taxpayers/${taxpayerId}/tax-compliance-checks${this.qs(params)}`);
  }

  async getTaxComplianceCheck(id: string): Promise<SyntageTaxCompliance> {
    return this.request("GET", `/tax-compliance-checks/${id}`);
  }

  // ════════════════════════════════════════════════════════════
  // TAX STATUS — Constancia de situacion fiscal
  // ════════════════════════════════════════════════════════════

  async listTaxStatus(taxpayerId: string, params?: Record<string, string>): Promise<SyntageCollection<SyntageTaxStatus>> {
    return this.request("GET", `/taxpayers/${taxpayerId}/tax-status${this.qs(params)}`);
  }

  async getTaxStatus(id: string): Promise<SyntageTaxStatus> {
    return this.request("GET", `/tax-status/${id}`);
  }

  // ════════════════════════════════════════════════════════════
  // CERTIFICATES — e.FIRMA / CSD
  // ════════════════════════════════════════════════════════════

  async listCertificates(entityId: string, params?: Record<string, string>): Promise<SyntageCollection<SyntageCertificate>> {
    return this.request("GET", `/entities/${entityId}/datasources/mx/sat/certificados${this.qs(params)}`);
  }

  async getCertificate(id: string): Promise<SyntageCertificate> {
    return this.request("GET", `/datasources/mx/sat/certificados/${id}`);
  }

  // ════════════════════════════════════════════════════════════
  // INSIGHTS — Financial analytics from SAT data
  // ════════════════════════════════════════════════════════════

  async getBalanceSheet(taxpayerId: string, params?: Record<string, string>): Promise<SyntageInsights> {
    return this.request("GET", `/taxpayers/${taxpayerId}/insights/metrics/balance-sheet${this.qs(params)}`);
  }

  async getIncomeStatement(taxpayerId: string, params?: Record<string, string>): Promise<SyntageInsights> {
    return this.request("GET", `/taxpayers/${taxpayerId}/insights/metrics/income-statement${this.qs(params)}`);
  }

  async getAccountsPayable(insightId: string, params?: Record<string, string>): Promise<SyntageInsights> {
    return this.request("GET", `/insights/${insightId}/accounts-payable${this.qs(params)}`);
  }

  async getAccountsReceivable(insightId: string, params?: Record<string, string>): Promise<SyntageInsights> {
    return this.request("GET", `/insights/${insightId}/accounts-receivable${this.qs(params)}`);
  }

  async getCashFlow(insightId: string, params?: Record<string, string>): Promise<SyntageInsights> {
    return this.request("GET", `/insights/${insightId}/cash-flow${this.qs(params)}`);
  }

  async getCustomerConcentration(insightId: string, params?: Record<string, string>): Promise<SyntageInsights> {
    return this.request("GET", `/insights/${insightId}/customer-concentration${this.qs(params)}`);
  }

  async getVendorConcentration(insightId: string, params?: Record<string, string>): Promise<SyntageInsights> {
    return this.request("GET", `/insights/${insightId}/vendor-concentration${this.qs(params)}`);
  }

  async getSalesRevenue(insightId: string, params?: Record<string, string>): Promise<SyntageInsights> {
    return this.request("GET", `/insights/${insightId}/sales-revenue${this.qs(params)}`);
  }

  async getFinancialRatios(insightId: string, params?: Record<string, string>): Promise<SyntageInsights> {
    return this.request("GET", `/insights/${insightId}/financial-ratios${this.qs(params)}`);
  }

  async getScores(entityId: string, params?: Record<string, string>): Promise<SyntageInsights> {
    return this.request("GET", `/entities/${entityId}/insights/metrics/scores${this.qs(params)}`);
  }

  async getTrialBalance(insightId: string, params?: Record<string, string>): Promise<SyntageInsights> {
    return this.request("GET", `/insights/${insightId}/trial-balance${this.qs(params)}`);
  }

  // ════════════════════════════════════════════════════════════
  // FILES
  // ════════════════════════════════════════════════════════════

  async getFile(id: string): Promise<{ downloadUrl: string }> {
    return this.request("GET", `/files/${id}`);
  }

  async listFiles(taxpayerId: string, params?: Record<string, string>): Promise<SyntageCollection<{ id: string; name: string; size: number }>> {
    return this.request("GET", `/taxpayers/${taxpayerId}/files${this.qs(params)}`);
  }

  // ════════════════════════════════════════════════════════════
  // EXPORTS — CSV/XLSX
  // ════════════════════════════════════════════════════════════

  async createExport(data: { format: "csv" | "xlsx"; taxpayer: string; type?: string }): Promise<SyntageExport> {
    return this.request("POST", "/exports", data);
  }

  async getExport(id: string): Promise<SyntageExport> {
    return this.request("GET", `/exports/${id}`);
  }

  async deleteExport(id: string): Promise<void> {
    return this.request("DELETE", `/exports/${id}`);
  }

  // ════════════════════════════════════════════════════════════
  // WEBHOOKS
  // ════════════════════════════════════════════════════════════

  async createWebhook(url: string, events: string[]): Promise<SyntageWebhook> {
    return this.request("POST", "/webhook-endpoints", { url, enabledEvents: events });
  }

  async listWebhooks(params?: Record<string, string>): Promise<SyntageCollection<SyntageWebhook>> {
    return this.request("GET", `/webhook-endpoints${this.qs(params)}`);
  }

  async getWebhook(id: string): Promise<SyntageWebhook> {
    return this.request("GET", `/webhook-endpoints/${id}`);
  }

  async updateWebhook(id: string, data: Partial<{ url: string; enabledEvents: string[] }>): Promise<SyntageWebhook> {
    return this.request("PUT", `/webhook-endpoints/${id}`, data);
  }

  async deleteWebhook(id: string): Promise<void> {
    return this.request("DELETE", `/webhook-endpoints/${id}`);
  }

  async listWebhookRequests(params?: Record<string, string>): Promise<SyntageCollection<unknown>> {
    return this.request("GET", `/webhook-requests${this.qs(params)}`);
  }

  // ════════════════════════════════════════════════════════════
  // EVENTS
  // ════════════════════════════════════════════════════════════

  async listEvents(params?: Record<string, string>): Promise<SyntageCollection<{ id: string; type: string; data: unknown; createdAt: string }>> {
    return this.request("GET", `/events${this.qs(params)}`);
  }

  async getEvent(id: string): Promise<{ id: string; type: string; data: unknown; createdAt: string }> {
    return this.request("GET", `/events/${id}`);
  }

  // ════════════════════════════════════════════════════════════
  // BACKGROUND CHECKS
  // ════════════════════════════════════════════════════════════

  async listBackgroundChecks(entityId: string, params?: Record<string, string>): Promise<SyntageCollection<SyntageBackgroundCheck>> {
    return this.request("GET", `/entities/${entityId}/background-checks${this.qs(params)}`);
  }

  async getBackgroundCheck(id: string): Promise<SyntageBackgroundCheck> {
    return this.request("GET", `/background-checks/${id}`);
  }

  async getBackgroundCheckPdf(id: string): Promise<{ downloadUrl: string }> {
    return this.request("GET", `/background-checks/${id}/pdf`);
  }

  async getBackgroundCheckRecords(id: string, params?: Record<string, string>): Promise<SyntageCollection<unknown>> {
    return this.request("GET", `/background-checks/${id}/records${this.qs(params)}`);
  }

  // ════════════════════════════════════════════════════════════
  // BURO DE CREDITO
  // ════════════════════════════════════════════════════════════

  async authorizeBuroDeCredito(entityId: string, data: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", `/entities/${entityId}/datasources/mx/buro-de-credito/authorizations`, data);
  }

  async listBuroDeCreditoReports(entityId: string): Promise<SyntageCollection<unknown>> {
    return this.request("GET", `/entities/${entityId}/datasources/mx/buro-de-credito/reports`);
  }

  // ════════════════════════════════════════════════════════════
  // SCHEDULERS
  // ════════════════════════════════════════════════════════════

  async createScheduler(data: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", "/schedulers", data);
  }

  async listSchedulers(params?: Record<string, string>): Promise<SyntageCollection<unknown>> {
    return this.request("GET", `/schedulers${this.qs(params)}`);
  }

  async getScheduler(id: string): Promise<unknown> {
    return this.request("GET", `/schedulers/${id}`);
  }

  async updateScheduler(id: string, data: Record<string, unknown>): Promise<unknown> {
    return this.request("PUT", `/schedulers/${id}`, data);
  }

  async deleteScheduler(id: string): Promise<void> {
    return this.request("DELETE", `/schedulers/${id}`);
  }

  // ════════════════════════════════════════════════════════════
  // ADDRESS LOOKUP
  // ════════════════════════════════════════════════════════════

  async lookupAddress(postalCode: string): Promise<unknown> {
    return this.request("GET", `/datasources/mx/addresses/${postalCode}`);
  }

  // ════════════════════════════════════════════════════════════
  // TEST CONNECTION
  // ════════════════════════════════════════════════════════════

  async testConnection(): Promise<{ ok: boolean; taxpayers: number; credentials: number; error?: string }> {
    try {
      const [taxpayers, credentials] = await Promise.all([
        this.listTaxpayers(),
        this.listCredentials(),
      ]);
      return {
        ok: true,
        taxpayers: taxpayers["hydra:totalItems"] || 0,
        credentials: credentials["hydra:totalItems"] || 0,
      };
    } catch (e) {
      return { ok: false, taxpayers: 0, credentials: 0, error: e instanceof Error ? e.message : "Error de conexion" };
    }
  }
}

// ── Webhook signature validation ──

export function validateSyntageWebhook(
  body: string,
  signatureHeader: string,
  secret: string,
): boolean {
  // Parse "t=<timestamp>,s=<signature>"
  const parts = signatureHeader.split(",");
  const timestamp = parts.find(p => p.startsWith("t="))?.slice(2);
  const signature = parts.find(p => p.startsWith("s="))?.slice(2);
  if (!timestamp || !signature) return false;

  // Requires crypto.subtle (available in Edge Runtime / Node 18+)
  // For sync validation, use node crypto:
  try {
    const crypto = require("crypto");
    const signedPayload = `${timestamp}.${body}`;
    const expected = crypto
      .createHmac("sha256", secret)
      .update(signedPayload)
      .digest("hex");
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

// ── Factory ──

export function createSyntageClient(config: Record<string, string>): SyntageClient {
  const { syntageApiKey, syntageEnvironment } = config;
  if (!syntageApiKey) throw new Error("Falta la API Key de Syntage");
  return new SyntageClient({
    apiKey: syntageApiKey,
    sandbox: syntageEnvironment === "sandbox",
  });
}
