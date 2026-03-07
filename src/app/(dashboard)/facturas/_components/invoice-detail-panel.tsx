"use client";

import {
  Eye,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

import { formatMoney, formatDate } from "@/lib/utils/format";
import type { Invoice } from "@/types";

import { StatusBadge } from "@/components/shared/status-badge";
import { PermissionGate } from "@/components/shared/permission-gate";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { SatSemaphore } from "./columns";

/* ---------- Invoice Detail Content ---------- */

export function InvoiceDetailContent({ invoice }: { invoice: Invoice }) {
  const uuid = invoice.cfdi_uuid || invoice.odoo_cfdi_uuid;

  return (
    <div className="space-y-6 py-4">
      {/* General Info */}
      <section className="space-y-3">
        <h4 className="font-semibold text-sm">Informacion General</h4>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-muted-foreground">Numero:</span>
            <div className="font-medium">{invoice.name}</div>
          </div>
          <div>
            <span className="text-muted-foreground">Tipo:</span>
            <div className="font-medium">
              {invoice.move_type === "in_invoice"
                ? "Por Pagar"
                : invoice.move_type === "out_invoice"
                ? "Por Cobrar"
                : invoice.move_type || "-"}
            </div>
          </div>
          <div>
            <span className="text-muted-foreground">Emisor/Proveedor:</span>
            <div className="font-medium">{invoice.partner_name || invoice.emisor_nombre || "-"}</div>
          </div>
          <div>
            <span className="text-muted-foreground">RFC:</span>
            <div className="font-mono text-xs">{invoice.partner_rfc || "-"}</div>
          </div>
          <div>
            <span className="text-muted-foreground">Monto Total:</span>
            <div className="font-medium font-mono">{formatMoney(invoice.amount_total ?? 0)}</div>
          </div>
          <div>
            <span className="text-muted-foreground">Saldo:</span>
            <div className="font-medium font-mono">{formatMoney(invoice.amount_residual ?? 0)}</div>
          </div>
          <div>
            <span className="text-muted-foreground">Fecha Factura:</span>
            <div>{invoice.date_invoice ? formatDate(invoice.date_invoice) : "-"}</div>
          </div>
          <div>
            <span className="text-muted-foreground">Vencimiento:</span>
            <div>{invoice.date_due ? formatDate(invoice.date_due) : "-"}</div>
          </div>
          <div>
            <span className="text-muted-foreground">Metodo Pago:</span>
            <div>{invoice.metodo_pago || invoice.payment_policy || "-"}</div>
          </div>
          <div>
            <span className="text-muted-foreground">Forma Pago:</span>
            <div>{invoice.forma_pago || invoice.odoo_payment_method || "-"}</div>
          </div>
          <div>
            <span className="text-muted-foreground">Moneda:</span>
            <div>{invoice.moneda || invoice.currency || "MXN"}</div>
          </div>
          <div>
            <span className="text-muted-foreground">Uso CFDI:</span>
            <div>{invoice.uso_cfdi || invoice.odoo_usage || "-"}</div>
          </div>
        </div>
      </section>

      {/* CFDI Info */}
      <section className="space-y-3">
        <h4 className="font-semibold text-sm">CFDI</h4>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="col-span-2">
            <span className="text-muted-foreground">UUID:</span>
            <div className="font-mono text-xs break-all">{uuid || "-"}</div>
          </div>
          <div>
            <span className="text-muted-foreground">Estado SAT:</span>
            <div className="mt-0.5">
              {invoice.sat_status ? (
                <SatSemaphore satStatus={invoice.sat_status} efosStatus={invoice.efos_status} />
              ) : (
                <Badge variant="outline">No validado</Badge>
              )}
            </div>
          </div>
          <div>
            <span className="text-muted-foreground">EFOS:</span>
            <div>{invoice.efos_status || "No verificado"}</div>
          </div>
          {invoice.sat_last_check && (
            <div className="col-span-2">
              <span className="text-muted-foreground">Ultima validacion:</span>
              <div>{formatDate(invoice.sat_last_check)}</div>
            </div>
          )}
          {invoice.es_cancelable && (
            <div>
              <span className="text-muted-foreground">Cancelable:</span>
              <div>{invoice.es_cancelable}</div>
            </div>
          )}
        </div>
      </section>

      {/* Payment Status */}
      <section className="space-y-3">
        <h4 className="font-semibold text-sm">Estado de Pago</h4>
        <div className="flex items-center gap-2">
          <StatusBadge status={invoice.payment_state || "not_paid"} />
          {invoice.amount_residual != null &&
            invoice.amount_total != null &&
            invoice.amount_residual > 0 &&
            invoice.amount_residual < invoice.amount_total && (
              <span className="text-xs text-muted-foreground">
                ({formatMoney(invoice.amount_total - invoice.amount_residual)} abonado)
              </span>
            )}
        </div>
      </section>
    </div>
  );
}

/* ---------- Payment Related Content ---------- */

export function InvoicePaymentsContent({ invoice }: { invoice: Invoice }) {
  return (
    <div className="py-4 space-y-4">
      <h4 className="font-semibold text-sm">Pagos Relacionados</h4>
      <p className="text-sm text-muted-foreground">
        Los pagos asociados a esta factura se muestran aqui.
      </p>
      {invoice.payment_state === "paid" && (
        <div className="rounded border p-3 text-sm">
          <div className="flex items-center gap-2 text-green-700">
            <CheckCircle2 className="size-4" />
            <span className="font-medium">Factura totalmente pagada</span>
          </div>
        </div>
      )}
      {invoice.payment_state === "partial" && (
        <div className="rounded border p-3 text-sm">
          <div className="flex items-center gap-2 text-amber-700">
            <AlertTriangle className="size-4" />
            <span className="font-medium">Pago parcial registrado</span>
          </div>
          <div className="mt-1 text-muted-foreground">
            Saldo pendiente: {formatMoney(invoice.amount_residual ?? 0)}
          </div>
        </div>
      )}
      {(invoice.payment_state === "not_paid" || !invoice.payment_state) && (
        <div className="rounded border p-3 text-sm text-muted-foreground">
          No hay pagos registrados para esta factura.
        </div>
      )}
    </div>
  );
}

/* ---------- CFDI Tab Content ---------- */

export function InvoiceCfdiContent({
  invoice,
  onViewXml,
  onValidate,
}: {
  invoice: Invoice;
  onViewXml: () => void;
  onValidate: () => void;
}) {
  return (
    <div className="py-4 space-y-4">
      <h4 className="font-semibold text-sm">Detalle CFDI</h4>
      <div className="space-y-3 text-sm">
        <div>
          <span className="text-muted-foreground">UUID:</span>
          <div className="font-mono text-xs break-all mt-0.5">
            {invoice.cfdi_uuid || invoice.odoo_cfdi_uuid || "-"}
          </div>
        </div>
        <div>
          <span className="text-muted-foreground">Tipo Comprobante:</span>
          <div>{invoice.tipo_comprobante || "-"}</div>
        </div>
        <div>
          <span className="text-muted-foreground">Emisor Regimen:</span>
          <div>{invoice.emisor_regimen || "-"}</div>
        </div>
        <div>
          <span className="text-muted-foreground">Receptor Regimen:</span>
          <div>{invoice.receptor_regimen || "-"}</div>
        </div>
        <div>
          <span className="text-muted-foreground">Lugar Expedicion:</span>
          <div>{invoice.lugar_expedicion || "-"}</div>
        </div>
        <div>
          <span className="text-muted-foreground">Descuento:</span>
          <div>
            {invoice.descuento != null
              ? formatMoney(invoice.descuento)
              : "-"}
          </div>
        </div>
        <div>
          <span className="text-muted-foreground">Semaforo SAT:</span>
          <div className="mt-1">
            <SatSemaphore
              satStatus={invoice.sat_status}
              efosStatus={invoice.efos_status}
            />
          </div>
        </div>
        {invoice.es_cancelable && (
          <div>
            <span className="text-muted-foreground">Cancelable:</span>
            <div>{invoice.es_cancelable}</div>
          </div>
        )}
        {invoice.estatus_cancelacion && (
          <div>
            <span className="text-muted-foreground">Estatus Cancelacion:</span>
            <div>{invoice.estatus_cancelacion}</div>
          </div>
        )}
      </div>

      <div className="flex gap-2 pt-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onViewXml}
        >
          <Eye className="mr-1.5 size-3.5" />
          Ver XML
        </Button>
        <PermissionGate permission="invoices:validate">
          <Button
            variant="outline"
            size="sm"
            onClick={onValidate}
          >
            <ShieldCheck className="mr-1.5 size-3.5" />
            Validar SAT
          </Button>
        </PermissionGate>
      </div>
    </div>
  );
}

/* ---------- Detail Panel Children ---------- */

export function DetailPanelChildren({
  selectedInvoice,
  onViewXml,
  onValidate,
}: {
  selectedInvoice: Invoice | null;
  onViewXml: () => void;
  onValidate: () => void;
}) {
  return (
    <>
      {/* Tab: Detalle */}
      {selectedInvoice ? (
        <InvoiceDetailContent invoice={selectedInvoice} />
      ) : (
        <Skeleton className="h-40 w-full" />
      )}

      {/* Tab: Pagos */}
      {selectedInvoice ? (
        <InvoicePaymentsContent invoice={selectedInvoice} />
      ) : (
        <Skeleton className="h-40 w-full" />
      )}

      {/* Tab: CFDI */}
      {selectedInvoice ? (
        <InvoiceCfdiContent
          invoice={selectedInvoice}
          onViewXml={onViewXml}
          onValidate={onValidate}
        />
      ) : (
        <Skeleton className="h-40 w-full" />
      )}
    </>
  );
}
