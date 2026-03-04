"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { Invoice } from "@/types";
import { toast } from "sonner";
import { FileText, Loader2, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

/* ---------- helpers ---------- */

function formatMXN(amount: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(amount);
}

function formatDate(dateStr?: string) {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

type BadgeVariant = "default" | "secondary" | "outline" | "destructive";

const CFDI_BADGE: Record<string, { label: string; variant: BadgeVariant }> = {
  valid: { label: "Vigente", variant: "default" },
  vigente: { label: "Vigente", variant: "default" },
  cancelled: { label: "Cancelado", variant: "destructive" },
  cancelado: { label: "Cancelado", variant: "destructive" },
  pending: { label: "Pendiente", variant: "secondary" },
  pendiente: { label: "Pendiente", variant: "secondary" },
  not_found: { label: "No encontrado", variant: "outline" },
};

function cfdiBadge(status?: string) {
  if (!status) return <Badge variant="outline">Sin CFDI</Badge>;
  const key = status.toLowerCase();
  const cfg = CFDI_BADGE[key] ?? {
    label: status,
    variant: "secondary" as BadgeVariant,
  };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

/* ---------- CFDI Detail Dialog ---------- */

interface CfdiDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: number | null;
}

function CfdiDialog({ open, onOpenChange, invoiceId }: CfdiDialogProps) {
  const [cfdi, setCfdi] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !invoiceId) return;
    setLoading(true);
    setCfdi(null);
    api.invoices
      .cfdi(invoiceId)
      .then(setCfdi)
      .catch((err: any) =>
        toast.error(err.message || "Error al cargar CFDI")
      )
      .finally(() => setLoading(false));
  }, [open, invoiceId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-5" />
            Detalle CFDI
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : !cfdi ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No se encontraron datos del CFDI.
          </p>
        ) : (
          <div className="grid gap-4 py-2">
            <DetailRow label="UUID" value={cfdi.uuid || cfdi.cfdi_uuid || "-"} mono />
            <DetailRow label="Emisor" value={cfdi.emisor || cfdi.emisor_name || cfdi.emisor_rfc || "-"} />
            <DetailRow label="RFC Emisor" value={cfdi.emisor_rfc || cfdi.rfc_emisor || "-"} mono />
            <DetailRow label="Receptor" value={cfdi.receptor || cfdi.receptor_name || cfdi.receptor_rfc || "-"} />
            <DetailRow label="RFC Receptor" value={cfdi.receptor_rfc || cfdi.rfc_receptor || "-"} mono />
            <DetailRow
              label="Total"
              value={cfdi.total != null ? formatMXN(cfdi.total) : "-"}
            />
            <DetailRow label="Estado SAT" value={cfdi.sat_status || cfdi.estado || "-"} />
            <DetailRow
              label="Sello"
              value={cfdi.sello || cfdi.sello_cfdi || "-"}
              mono
              truncate
            />
            {cfdi.fecha_timbrado && (
              <DetailRow label="Fecha timbrado" value={cfdi.fecha_timbrado} />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({
  label,
  value,
  mono,
  truncate,
}: {
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2 text-sm">
      <span className="font-medium text-muted-foreground">{label}</span>
      <span
        className={`${mono ? "font-mono text-xs" : ""} ${
          truncate ? "truncate" : ""
        } break-all`}
      >
        {value}
      </span>
    </div>
  );
}

/* ---------- Main Page ---------- */

export default function FacturasPage() {
  const [receivable, setReceivable] = useState<Invoice[]>([]);
  const [payable, setPayable] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [activeTab, setActiveTab] = useState("receivable");

  // CFDI dialog state
  const [cfdiOpen, setCfdiOpen] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(
    null
  );

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const [rec, pay] = await Promise.all([
        overdueOnly
          ? api.invoices.overdueReceivable()
          : api.invoices.receivable(),
        overdueOnly
          ? api.invoices.overduePayable()
          : api.invoices.payable(),
      ]);
      setReceivable(rec);
      setPayable(pay);
    } catch (err: any) {
      toast.error(err.message || "Error al cargar facturas");
    } finally {
      setLoading(false);
    }
  }, [overdueOnly]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  function handleRowClick(invoiceId: number) {
    setSelectedInvoiceId(invoiceId);
    setCfdiOpen(true);
  }

  /* ---------- render ---------- */

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Facturas</h1>
          <p className="text-muted-foreground text-sm">
            Consulta facturas por cobrar y por pagar sincronizadas con tu ERP.
          </p>
        </div>
      </div>

      {/* Overdue filter */}
      <div className="flex items-center gap-2">
        <Checkbox
          id="overdue-filter"
          checked={overdueOnly}
          onCheckedChange={(checked) => setOverdueOnly(checked === true)}
        />
        <Label htmlFor="overdue-filter" className="text-sm cursor-pointer">
          Solo vencidas
        </Label>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="receivable">
            <FileText className="mr-1.5 size-4" />
            Por Cobrar
          </TabsTrigger>
          <TabsTrigger value="payable">
            <FileText className="mr-1.5 size-4" />
            Por Pagar
          </TabsTrigger>
        </TabsList>

        {/* ---- Tab: Por Cobrar ---- */}
        <TabsContent value="receivable">
          <Card>
            <CardHeader>
              <CardTitle>
                Facturas por Cobrar
                {overdueOnly && (
                  <Badge variant="destructive" className="ml-2">
                    Vencidas
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              ) : receivable.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No hay facturas por cobrar
                  {overdueOnly ? " vencidas" : ""}.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Factura</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead className="text-right">Monto Total</TableHead>
                      <TableHead className="text-right">
                        Saldo Pendiente
                      </TableHead>
                      <TableHead>Vencimiento</TableHead>
                      <TableHead>Estado CFDI</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {receivable.map((inv) => (
                      <TableRow
                        key={inv.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => handleRowClick(inv.id)}
                      >
                        <TableCell className="font-medium">
                          {inv.name || `FAC-${inv.id}`}
                        </TableCell>
                        <TableCell>{inv.partner || "-"}</TableCell>
                        <TableCell className="text-right font-mono">
                          {formatMXN(inv.amount_total ?? inv.amount ?? 0)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatMXN(inv.amount_residual ?? 0)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(
                            inv.invoice_date_due ?? inv.due_date
                          )}
                        </TableCell>
                        <TableCell>
                          {cfdiBadge(inv.payment_state ?? (inv.cfdi_uuid ? "valid" : undefined))}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRowClick(inv.id);
                            }}
                          >
                            <ExternalLink className="mr-1.5 size-3.5" />
                            Ver CFDI
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Tab: Por Pagar ---- */}
        <TabsContent value="payable">
          <Card>
            <CardHeader>
              <CardTitle>
                Facturas por Pagar
                {overdueOnly && (
                  <Badge variant="destructive" className="ml-2">
                    Vencidas
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              ) : payable.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No hay facturas por pagar
                  {overdueOnly ? " vencidas" : ""}.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Factura</TableHead>
                      <TableHead>Proveedor</TableHead>
                      <TableHead className="text-right">Monto Total</TableHead>
                      <TableHead className="text-right">
                        Saldo Pendiente
                      </TableHead>
                      <TableHead>Vencimiento</TableHead>
                      <TableHead>Estado CFDI</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payable.map((inv) => (
                      <TableRow
                        key={inv.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => handleRowClick(inv.id)}
                      >
                        <TableCell className="font-medium">
                          {inv.name || `FAC-${inv.id}`}
                        </TableCell>
                        <TableCell>{inv.partner || "-"}</TableCell>
                        <TableCell className="text-right font-mono">
                          {formatMXN(inv.amount_total ?? inv.amount ?? 0)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatMXN(inv.amount_residual ?? 0)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(
                            inv.invoice_date_due ?? inv.due_date
                          )}
                        </TableCell>
                        <TableCell>
                          {cfdiBadge(inv.payment_state ?? (inv.cfdi_uuid ? "valid" : undefined))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* CFDI Detail Dialog */}
      <CfdiDialog
        open={cfdiOpen}
        onOpenChange={setCfdiOpen}
        invoiceId={selectedInvoiceId}
      />
    </div>
  );
}
