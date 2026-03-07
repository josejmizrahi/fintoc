export interface SyntageInvoice {
  id: string;
  uuid: string;
  type: string;
  status: string;
  issuer: { rfc: string; name: string; fiscalRegime?: string };
  receiver: { rfc: string; name: string; cfdiUse?: string };
  total: number;
  subtotal: number;
  currency: string;
  paymentMethod?: string;
  paymentForm?: string;
  issuedAt: string;
  certifiedAt: string;
  cancelledAt?: string;
  blacklistStatus?: string;
}

export interface SyntageExtraction {
  id: string;
  status: string;
  extractor: string;
  taxpayer: string;
  createdAt: string;
  updatedAt: string;
}

export interface SyntageTaxpayer {
  id: string;
  rfc: string;
  name?: string;
}
