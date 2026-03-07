"use client";

import { FileDown } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { formatMoney, formatDate } from "@/lib/utils/format";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { cfdiTypeBadge, satStatusBadge } from "./helpers";
import type { SyntageInvoice } from "./types";

async function handleDownloadCfdi(invoiceId: string, _format: string) {
  try {
    const data = await api.sat.syntage.invoiceCfdi(invoiceId);
    if (data.downloadUrl) window.open(data.downloadUrl, "_blank");
    else toast.info("CFDI descargado");
  } catch {
    toast.error("Error al descargar CFDI");
  }
}

export function InvoiceDetailDialog({
  invoice,
  onClose,
}: {
  invoice: SyntageInvoice;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!invoice} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Detalle CFDI</DialogTitle>
          <DialogDescription>UUID: {invoice.uuid}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Emisor</p>
            <p className="font-medium">{invoice.issuer?.name}</p>
            <p className="text-xs text-muted-foreground">RFC: {invoice.issuer?.rfc}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Receptor</p>
            <p className="font-medium">{invoice.receiver?.name}</p>
            <p className="text-xs text-muted-foreground">RFC: {invoice.receiver?.rfc}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Tipo</p>
            {cfdiTypeBadge(invoice.type)}
          </div>
          <div>
            <p className="text-muted-foreground">Total</p>
            <p className="font-medium">{formatMoney(invoice.total, invoice.currency)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Subtotal</p>
            <p>{formatMoney(invoice.subtotal, invoice.currency)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Moneda</p>
            <p>{invoice.currency}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Fecha emision</p>
            <p>{invoice.issuedAt ? formatDate(invoice.issuedAt) : "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Metodo pago</p>
            <p>{invoice.paymentMethod || "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Forma pago</p>
            <p>{invoice.paymentForm || "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Estado SAT</p>
            {satStatusBadge(invoice.status)}
          </div>
          {invoice.cancelledAt && (
            <div>
              <p className="text-muted-foreground">Fecha cancelacion</p>
              <p className="text-red-600">{formatDate(invoice.cancelledAt)}</p>
            </div>
          )}
          {invoice.receiver?.cfdiUse && (
            <div>
              <p className="text-muted-foreground">Uso CFDI</p>
              <p>{invoice.receiver.cfdiUse}</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleDownloadCfdi(invoice.id, "xml")}>
            <FileDown className="h-4 w-4 mr-2" /> XML
          </Button>
          <Button variant="outline" onClick={() => handleDownloadCfdi(invoice.id, "pdf")}>
            <FileDown className="h-4 w-4 mr-2" /> PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
