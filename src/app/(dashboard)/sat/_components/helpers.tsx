"use client";

import { Badge } from "@/components/ui/badge";
import { TIPO_COMPROBANTE } from "@/lib/constants/cfdi";

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

export const TIPO_LABELS: Record<string, string> = {
  I: "Ingreso",
  E: "Egreso",
  P: "Pago",
  N: "Nomina",
  T: "Traslado",
  ...TIPO_COMPROBANTE,
};

export const EXTRACTOR_LABELS: Record<string, string> = {
  invoice: "Facturas CFDI",
  annual_tax_return: "Declaracion Anual",
  monthly_tax_return: "Declaracion Mensual",
  electronic_accounting: "Contabilidad Electronica",
  tax_status: "Constancia Fiscal",
  tax_compliance: "Opinion Cumplimiento",
  tax_retention: "Retenciones",
  rpc: "Registro Publico",
  buro_de_credito_report: "Buro de Credito",
};

export const satKeys = {
  all: ["sat-syntage"] as const,
  status: () => [...satKeys.all, "status"] as const,
  taxpayers: () => [...satKeys.all, "taxpayers"] as const,
  credentials: () => [...satKeys.all, "credentials"] as const,
  invoices: (taxpayerId: string, params: Record<string, string>) =>
    [...satKeys.all, "invoices", taxpayerId, params] as const,
  extractions: () => [...satKeys.all, "extractions"] as const,
  taxReturns: (taxpayerId: string) => [...satKeys.all, "tax-returns", taxpayerId] as const,
  taxCompliance: (taxpayerId: string) => [...satKeys.all, "tax-compliance", taxpayerId] as const,
  taxStatus: (taxpayerId: string) => [...satKeys.all, "tax-status", taxpayerId] as const,
  taxRetentions: (taxpayerId: string) => [...satKeys.all, "tax-retentions", taxpayerId] as const,
};

/* ------------------------------------------------------------------ */
/* Badge helpers                                                       */
/* ------------------------------------------------------------------ */

export function cfdiTypeBadge(type: string) {
  const colors: Record<string, string> = {
    I: "bg-green-100 text-green-800",
    E: "bg-red-100 text-red-800",
    P: "bg-blue-100 text-blue-800",
    N: "bg-purple-100 text-purple-800",
    T: "bg-gray-100 text-gray-800",
  };
  return (
    <Badge variant="outline" className={colors[type] || "bg-gray-100 text-gray-800"}>
      {TIPO_LABELS[type] || type}
    </Badge>
  );
}

export function satStatusBadge(status: string) {
  if (!status) return <Badge variant="outline" className="text-muted-foreground">Sin validar</Badge>;
  if (status === "Vigente") return <Badge className="bg-green-100 text-green-800 hover:bg-green-200">Vigente</Badge>;
  if (status === "Cancelado") return <Badge variant="destructive">Cancelado</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

export function extractionStatusBadge(status: string) {
  const map: Record<string, { class: string; label: string }> = {
    pending: { class: "bg-gray-100 text-gray-800", label: "Pendiente" },
    waiting: { class: "bg-yellow-100 text-yellow-800", label: "En espera" },
    running: { class: "bg-blue-100 text-blue-800 animate-pulse", label: "Ejecutando..." },
    finished: { class: "bg-green-100 text-green-800", label: "Completada" },
    failed: { class: "bg-red-100 text-red-800", label: "Fallida" },
    stopping: { class: "bg-orange-100 text-orange-800", label: "Deteniendo..." },
    stopped: { class: "bg-gray-100 text-gray-800", label: "Detenida" },
    cancelled: { class: "bg-gray-100 text-gray-800", label: "Cancelada" },
  };
  const info = map[status] || { class: "bg-gray-100 text-gray-800", label: status };
  return <Badge variant="outline" className={info.class}>{info.label}</Badge>;
}

export function complianceBadge(result: string) {
  if (result === "positive") return <Badge className="bg-green-100 text-green-800">Positiva</Badge>;
  if (result === "negative") return <Badge variant="destructive">Negativa</Badge>;
  if (result === "no_obligations") return <Badge variant="outline">Sin obligaciones</Badge>;
  if (result === "activity_suspended") return <Badge className="bg-yellow-100 text-yellow-800">Actividad suspendida</Badge>;
  return <Badge variant="outline">{result}</Badge>;
}
