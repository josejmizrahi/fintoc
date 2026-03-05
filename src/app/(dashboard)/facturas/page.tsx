"use client";

import { useState, useMemo, useCallback } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import {
  FileText,
  MoreHorizontal,
  ShieldCheck,
  Eye,
  CreditCard,
  Link2,
  Receipt,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Loader2,
  CheckCircle2,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { usePayableInvoices, useReceivableInvoices, invoiceKeys } from "@/lib/hooks/use-invoices";
import { useInvoiceFilters } from "@/lib/hooks/use-url-state";
import { usePermission } from "@/lib/hooks/use-permission";
import { api } from "@/lib/api";
import { formatMoney, formatDate } from "@/lib/utils/format";
import { CANCELLATION_MOTIVOS } from "@/lib/utils/constants";
import type { Invoice } from "@/types";

import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { DetailPanel } from "@/components/shared/detail-panel";
import { SearchInput } from "@/components/shared/search-input";
import { PermissionGate } from "@/components/shared/permission-gate";
import { FilterBar, type FilterConfig } from "@/components/shared/filter-bar";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";

/* ---------- Helpers ---------- */

function daysOverdue(dueDate?: string): number {
  if (!dueDate) return 0;
  const due = new Date(dueDate);
  const now = new Date();
  const diff = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 0;
}

function truncateUuid(uuid?: string, chars = 8): string {
  if (!uuid) return "-";
  return uuid.slice(0, chars) + "...";
}

function getSatSemaphoreColor(satStatus?: string, efosStatus?: string): "green" | "yellow" | "red" {
  const sat = satStatus?.toLowerCase();
  const efos = efosStatus?.toLowerCase();

  if (sat === "cancelado" || efos === "definitivo") return "red";
  if (sat === "vigente" && efos === "presunto") return "yellow";
  if (sat === "vigente") return "green";
  return "red";
}

function SatSemaphore({ satStatus, efosStatus }: { satStatus?: string; efosStatus?: string }) {
  const color = getSatSemaphoreColor(satStatus, efosStatus);
  const colorClasses = {
    green: "bg-green-500",
    yellow: "bg-yellow-500",
    red: "bg-red-500",
  };
  const labels = {
    green: "Vigente - EFOS limpio",
    yellow: "Vigente - Presunto EFOS",
    red: satStatus?.toLowerCase() === "cancelado" ? "Cancelado" : "Definitivo EFOS",
  };

  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block size-3 rounded-full ${colorClasses[color]}`} />
      <span className="text-xs">{labels[color]}</span>
    </div>
  );
}

/* ---------- Filter configuration ---------- */

const INVOICE_FILTERS: FilterConfig[] = [
  {
    key: "date",
    label: "Fecha",
    type: "date-range",
  },
  {
    key: "sat_status",
    label: "Estado SAT",
    type: "select",
    options: [
      { value: "vigente", label: "Vigente" },
      { value: "cancelado", label: "Cancelado" },
      { value: "no_validado", label: "No validado" },
    ],
  },
  {
    key: "payment_state",
    label: "Estado Pago",
    type: "select",
    options: [
      { value: "paid", label: "Pagado" },
      { value: "partial", label: "Parcial" },
      { value: "not_paid", label: "No pagado" },
    ],
  },
  {
    key: "metodo_pago",
    label: "Metodo Pago",
    type: "select",
    options: [
      { value: "PUE", label: "PUE" },
      { value: "PPD", label: "PPD" },
    ],
  },
  {
    key: "monto_min",
    label: "Monto min",
    type: "text",
    placeholder: "0.00",
  },
  {
    key: "monto_max",
    label: "Monto max",
    type: "text",
    placeholder: "999,999.99",
  },
];

/* ---------- Bulk Validation Result ---------- */

interface BulkValidationResult {
  uuid: string;
  invoiceName: string;
  previousStatus: string;
  newStatus: string;
  changed: boolean;
  efosStatus?: string;
}

/* ---------- XML Viewer Dialog ---------- */

function XmlViewerDialog({
  open,
  onOpenChange,
  invoiceId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: number | null;
}) {
  const [xml, setXml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadXml = useCallback(async () => {
    if (!invoiceId) return;
    setLoading(true);
    try {
      const data = await api.invoices.cfdi(invoiceId);
      setXml(data.xml || data.xml_content || "No se encontro contenido XML");
    } catch (err: any) {
      toast.error(err.message || "Error al cargar XML");
      setXml(null);
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  if (open && xml === null && !loading) {
    loadXml();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setXml(null);
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-5" />
            XML del CFDI
          </DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : xml ? (
          <ScrollArea className="h-[60vh]">
            <pre className="whitespace-pre-wrap break-all rounded bg-muted p-4 text-xs font-mono">
              {xml}
            </pre>
          </ScrollArea>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No se encontro contenido XML.
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (xml) {
                navigator.clipboard.writeText(xml);
                toast.success("XML copiado al portapapeles");
              }
            }}
          >
            <Copy className="mr-1.5 size-3.5" />
            Copiar XML
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Cancellation Dialog ---------- */

function CancellationDialog({
  open,
  onOpenChange,
  invoice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: Invoice | null;
}) {
  const [motivo, setMotivo] = useState("");
  const [uuidSustituto, setUuidSustituto] = useState("");
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();

  const handleSubmit = async () => {
    if (!invoice || !motivo) return;
    setLoading(true);
    try {
      await api.sat.cancel({
        invoice_id: invoice.id,
        cfdi_uuid: invoice.cfdi_uuid || invoice.odoo_cfdi_uuid,
        motivo,
        uuid_sustitucion: motivo === "01" ? uuidSustituto : undefined,
      });
      toast.success("Solicitud de cancelacion enviada");
      queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Error al solicitar cancelacion");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XCircle className="size-5 text-destructive" />
            Solicitar Cancelacion
          </DialogTitle>
          <DialogDescription>
            Cancelar CFDI: {invoice?.cfdi_uuid || invoice?.odoo_cfdi_uuid || invoice?.name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Motivo de cancelacion</Label>
            <Select value={motivo} onValueChange={setMotivo}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona un motivo" />
              </SelectTrigger>
              <SelectContent>
                {CANCELLATION_MOTIVOS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {motivo === "01" && (
            <div className="space-y-2">
              <Label>UUID del CFDI que sustituye</Label>
              <Input
                value={uuidSustituto}
                onChange={(e) => setUuidSustituto(e.target.value)}
                placeholder="Ej: 6fd3b2a4-1c2e-..."
                className="font-mono text-sm"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={loading || !motivo || (motivo === "01" && !uuidSustituto)}
          >
            {loading && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Solicitar Cancelacion
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Bulk Validation Dialog ---------- */

function BulkValidationDialog({
  open,
  onOpenChange,
  results,
  progress,
  total,
  isRunning,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  results: BulkValidationResult[];
  progress: number;
  total: number;
  isRunning: boolean;
}) {
  const [onlyChanges, setOnlyChanges] = useState(false);

  const filteredResults = onlyChanges ? results.filter((r) => r.changed) : results;

  return (
    <Dialog open={open} onOpenChange={isRunning ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5" />
            {isRunning ? "Validando contra el SAT..." : "Resultados de Validacion"}
          </DialogTitle>
        </DialogHeader>

        {isRunning ? (
          <div className="space-y-4 py-6">
            <div className="text-center text-sm text-muted-foreground">
              Validando {progress}/{total}...
            </div>
            <Progress value={total > 0 ? (progress / total) * 100 : 0} className="w-full" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {results.length} facturas validadas, {results.filter((r) => r.changed).length} con cambios
              </span>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="only-changes"
                  checked={onlyChanges}
                  onCheckedChange={(v) => setOnlyChanges(v === true)}
                />
                <Label htmlFor="only-changes" className="text-sm cursor-pointer">
                  Solo mostrar cambios
                </Label>
              </div>
            </div>

            <ScrollArea className="h-[50vh]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4">UUID</th>
                    <th className="pb-2 pr-4">Estado Anterior</th>
                    <th className="pb-2 pr-4">Estado Nuevo</th>
                    <th className="pb-2 pr-4">Cambio?</th>
                    <th className="pb-2">Semaforo</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredResults.map((r, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono text-xs">
                        {truncateUuid(r.uuid, 12)}
                      </td>
                      <td className="py-2 pr-4">
                        <StatusBadge status={r.previousStatus || "no_validado"} />
                      </td>
                      <td className="py-2 pr-4">
                        <StatusBadge status={r.newStatus || "no_validado"} />
                      </td>
                      <td className="py-2 pr-4">
                        {r.changed ? (
                          <Badge variant="default" className="bg-amber-500">Si</Badge>
                        ) : (
                          <Badge variant="secondary">No</Badge>
                        )}
                      </td>
                      <td className="py-2">
                        <SatSemaphore satStatus={r.newStatus} efosStatus={r.efosStatus} />
                      </td>
                    </tr>
                  ))}
                  {filteredResults.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-muted-foreground">
                        {onlyChanges ? "No hubo cambios en la validacion." : "Sin resultados."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </ScrollArea>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Complements Dialog ---------- */

function ComplementsDialog({
  open,
  onOpenChange,
  invoice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: Invoice | null;
}) {
  const [complements, setComplements] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!invoice) return;
    setLoading(true);
    try {
      const data = await api.invoices.cfdi(invoice.id);
      const comps = data.complementos || data.complemento_pago || [];
      setComplements(Array.isArray(comps) ? comps : [comps].filter(Boolean));
    } catch (err: any) {
      toast.error(err.message || "Error al cargar complementos");
      setComplements([]);
    } finally {
      setLoading(false);
    }
  }, [invoice]);

  if (open && complements === null && !loading) {
    load();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setComplements(null);
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="size-5" />
            Complementos de Pago
          </DialogTitle>
          <DialogDescription>
            Factura: {invoice?.name}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : complements && complements.length > 0 ? (
          <ScrollArea className="max-h-[50vh]">
            <div className="space-y-3">
              {complements.map((comp, i) => (
                <div key={i} className="rounded border p-3 text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="font-medium">Complemento #{i + 1}</span>
                    {comp.uuid && (
                      <span className="font-mono text-xs text-muted-foreground">
                        {truncateUuid(comp.uuid, 12)}
                      </span>
                    )}
                  </div>
                  {comp.fecha_pago && <div>Fecha: {formatDate(comp.fecha_pago)}</div>}
                  {comp.monto != null && <div>Monto: {formatMoney(comp.monto)}</div>}
                  {comp.forma_pago && <div>Forma pago: {comp.forma_pago}</div>}
                  {comp.moneda && <div>Moneda: {comp.moneda}</div>}
                </div>
              ))}
            </div>
          </ScrollArea>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No se encontraron complementos de pago.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Invoice Detail Panel Content ---------- */

function InvoiceDetailContent({ invoice }: { invoice: Invoice }) {
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

function InvoicePaymentsContent({ invoice }: { invoice: Invoice }) {
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

/* ---------- Column Definitions ---------- */

function useInvoiceColumns(
  tab: "payable" | "receivable",
  onAction: (action: string, invoice: Invoice) => void
): ColumnDef<Invoice, any>[] {
  const canValidate = usePermission("invoices:validate");
  const canCancelCfdi = usePermission("invoices:cancel-cfdi");
  const canCreatePayment = usePermission("payments:create");

  return useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Numero",
        cell: ({ row }) => (
          <span className="font-medium whitespace-nowrap">
            {row.original.name || `FAC-${row.original.id}`}
          </span>
        ),
        size: 120,
      },
      {
        id: "partner",
        header: tab === "payable" ? "Emisor" : "Receptor",
        cell: ({ row }) => {
          const inv = row.original;
          const name = inv.partner_name || inv.emisor_nombre || inv.receptor_nombre || "-";
          const rfc = inv.partner_rfc;
          return (
            <div className="flex flex-col gap-0.5">
              <span className="text-sm truncate max-w-[200px]">{name}</span>
              {rfc && (
                <Badge variant="outline" className="w-fit text-[10px] font-mono px-1.5 py-0">
                  {rfc}
                </Badge>
              )}
            </div>
          );
        },
        size: 200,
      },
      {
        accessorKey: "amount_total",
        header: "Monto Total",
        cell: ({ row }) => (
          <span className="font-mono text-sm whitespace-nowrap">
            {formatMoney(row.original.amount_total ?? 0)}
          </span>
        ),
        size: 130,
      },
      {
        accessorKey: "amount_residual",
        header: "Saldo",
        cell: ({ row }) => {
          const inv = row.original;
          const residual = inv.amount_residual ?? 0;
          const overdue = inv.date_due && daysOverdue(inv.date_due) > 0 && residual > 0;
          return (
            <span
              className={`font-mono text-sm whitespace-nowrap ${
                overdue ? "text-red-600 font-semibold" : ""
              }`}
            >
              {formatMoney(residual)}
            </span>
          );
        },
        size: 130,
      },
      {
        accessorKey: "date_invoice",
        header: "Fecha",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {row.original.date_invoice ? formatDate(row.original.date_invoice) : "-"}
          </span>
        ),
        size: 100,
      },
      {
        accessorKey: "date_due",
        header: "Vencimiento",
        cell: ({ row }) => {
          const inv = row.original;
          if (!inv.date_due) return <span className="text-sm text-muted-foreground">-</span>;
          const days = daysOverdue(inv.date_due);
          return (
            <div className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="text-sm">{formatDate(inv.date_due)}</span>
              {days > 0 && (inv.amount_residual ?? 0) > 0 && (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                  {days}d
                </Badge>
              )}
            </div>
          );
        },
        size: 140,
      },
      {
        id: "cfdi_uuid",
        header: "UUID CFDI",
        cell: ({ row }) => {
          const uuid = row.original.cfdi_uuid || row.original.odoo_cfdi_uuid;
          if (!uuid) return <span className="text-muted-foreground text-xs">-</span>;
          return (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="font-mono text-xs cursor-help">
                    {truncateUuid(uuid, 8)}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="font-mono text-xs">{uuid}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        },
        size: 110,
      },
      {
        id: "sat_status",
        header: "Estado SAT",
        cell: ({ row }) => {
          const inv = row.original;
          if (!inv.sat_status && !inv.sat_validated) {
            return <Badge variant="outline">No validado</Badge>;
          }
          return <StatusBadge status={inv.sat_status || "pending"} />;
        },
        size: 110,
      },
      {
        id: "metodo_pago",
        header: "Metodo Pago",
        cell: ({ row }) => {
          const mp = row.original.metodo_pago || row.original.payment_policy;
          if (!mp) return <span className="text-muted-foreground text-xs">-</span>;
          return (
            <Badge
              variant="secondary"
              className={
                mp === "PUE"
                  ? "bg-blue-100 text-blue-800 hover:bg-blue-100"
                  : mp === "PPD"
                  ? "bg-orange-100 text-orange-800 hover:bg-orange-100"
                  : ""
              }
            >
              {mp}
            </Badge>
          );
        },
        size: 100,
      },
      {
        id: "payment_state",
        header: "Estado Pago",
        cell: ({ row }) => {
          const ps = row.original.payment_state;
          if (!ps) return <StatusBadge status="not_paid" />;
          return <StatusBadge status={ps} />;
        },
        size: 110,
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => {
          const inv = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-8 p-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="size-4" />
                  <span className="sr-only">Acciones</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canValidate && (
                  <DropdownMenuItem onClick={() => onAction("validate", inv)}>
                    <ShieldCheck className="mr-2 size-4" />
                    Validar en SAT
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => onAction("xml", inv)}>
                  <Eye className="mr-2 size-4" />
                  Ver XML
                </DropdownMenuItem>

                {tab === "payable" && canCreatePayment && (
                  <DropdownMenuItem onClick={() => onAction("create_payment", inv)}>
                    <CreditCard className="mr-2 size-4" />
                    Crear Pago
                  </DropdownMenuItem>
                )}

                {tab === "receivable" && (
                  <DropdownMenuItem onClick={() => onAction("payment_link", inv)}>
                    <Link2 className="mr-2 size-4" />
                    Generar Link Cobro
                  </DropdownMenuItem>
                )}

                <DropdownMenuItem onClick={() => onAction("complements", inv)}>
                  <Receipt className="mr-2 size-4" />
                  Ver Complementos
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                {canCancelCfdi && (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => onAction("cancel", inv)}
                  >
                    <XCircle className="mr-2 size-4" />
                    Solicitar Cancelacion
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
        size: 50,
      },
    ],
    [tab, canValidate, canCancelCfdi, canCreatePayment, onAction]
  );
}

/* ---------- Main Page Component ---------- */

export default function FacturasPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useInvoiceFilters();
  const canValidate = usePermission("invoices:validate");

  // Tab state
  const [activeTab, setActiveTab] = useState<"payable" | "receivable">("payable");

  // Build query filters
  const queryFilters = useMemo(
    () => ({
      search: filters.search || undefined,
      page: filters.page,
      per_page: filters.per_page,
      date_from: filters.date_from || undefined,
      date_to: filters.date_to || undefined,
      status: filters.status || undefined,
    }),
    [filters]
  );

  // Data queries
  const payableQuery = usePayableInvoices(queryFilters);
  const receivableQuery = useReceivableInvoices(queryFilters);

  const payableData: Invoice[] = payableQuery.data ?? [];
  const receivableData: Invoice[] = receivableQuery.data ?? [];

  const currentData = activeTab === "payable" ? payableData : receivableData;
  const currentQuery = activeTab === "payable" ? payableQuery : receivableQuery;

  // Filter bar values
  const [filterBarValues, setFilterBarValues] = useState<Record<string, string>>({});

  // Local filtering based on FilterBar values (for filters not in URL state)
  const filteredData = useMemo(() => {
    let data = currentData;

    if (filterBarValues.sat_status) {
      data = data.filter((inv) => {
        if (filterBarValues.sat_status === "no_validado") {
          return !inv.sat_status && !inv.sat_validated;
        }
        return inv.sat_status?.toLowerCase() === filterBarValues.sat_status;
      });
    }

    if (filterBarValues.payment_state) {
      data = data.filter(
        (inv) => (inv.payment_state || "not_paid") === filterBarValues.payment_state
      );
    }

    if (filterBarValues.metodo_pago) {
      data = data.filter(
        (inv) =>
          (inv.metodo_pago || inv.payment_policy) === filterBarValues.metodo_pago
      );
    }

    if (filterBarValues.monto_min) {
      const min = parseFloat(filterBarValues.monto_min);
      if (!isNaN(min)) data = data.filter((inv) => (inv.amount_total ?? 0) >= min);
    }

    if (filterBarValues.monto_max) {
      const max = parseFloat(filterBarValues.monto_max);
      if (!isNaN(max)) data = data.filter((inv) => (inv.amount_total ?? 0) <= max);
    }

    if (filterBarValues.date_from) {
      data = data.filter((inv) => {
        const d = inv.date_invoice || inv.date_due;
        return d && d >= filterBarValues.date_from;
      });
    }

    if (filterBarValues.date_to) {
      data = data.filter((inv) => {
        const d = inv.date_invoice || inv.date_due;
        return d && d <= filterBarValues.date_to;
      });
    }

    return data;
  }, [currentData, filterBarValues]);

  // Count unvalidated invoices
  const unvalidatedCount = useMemo(() => {
    const all = [...payableData, ...receivableData];
    return all.filter((inv) => !inv.sat_status && !inv.sat_validated).length;
  }, [payableData, receivableData]);

  // Detail panel
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Dialog states
  const [xmlDialogOpen, setXmlDialogOpen] = useState(false);
  const [xmlInvoiceId, setXmlInvoiceId] = useState<number | null>(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelInvoice, setCancelInvoice] = useState<Invoice | null>(null);
  const [complementsDialogOpen, setComplementsDialogOpen] = useState(false);
  const [complementsInvoice, setComplementsInvoice] = useState<Invoice | null>(null);

  // Bulk validation
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);
  const [bulkTotal, setBulkTotal] = useState(0);
  const [bulkResults, setBulkResults] = useState<BulkValidationResult[]>([]);

  // Single invoice validation
  const handleValidateSingle = useCallback(
    async (invoice: Invoice) => {
      const uuid = invoice.cfdi_uuid || invoice.odoo_cfdi_uuid;
      if (!uuid) {
        toast.error("Esta factura no tiene UUID de CFDI");
        return;
      }
      try {
        const result = await api.sat.validate({ invoice_id: invoice.id, uuid });
        const newStatus = result.estado || result.sat_status || result.status;
        toast.success(`Validacion: ${newStatus || "completada"}`);
        queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
      } catch (err: any) {
        toast.error(err.message || "Error al validar en SAT");
      }
    },
    [queryClient]
  );

  // Bulk validation
  const handleBulkValidation = useCallback(async () => {
    const allInvoices = [...payableData, ...receivableData].filter(
      (inv) => inv.cfdi_uuid || inv.odoo_cfdi_uuid
    );

    if (allInvoices.length === 0) {
      toast.error("No hay facturas con UUID para validar");
      return;
    }

    setBulkResults([]);
    setBulkProgress(0);
    setBulkTotal(allInvoices.length);
    setBulkRunning(true);
    setBulkDialogOpen(true);

    const results: BulkValidationResult[] = [];

    for (let i = 0; i < allInvoices.length; i++) {
      const inv = allInvoices[i];
      const uuid = inv.cfdi_uuid || inv.odoo_cfdi_uuid || "";
      const previousStatus = inv.sat_status || "no_validado";

      try {
        const result = await api.sat.validate({ invoice_id: inv.id, uuid });
        const newStatus = result.estado || result.sat_status || result.status || "no_validado";
        results.push({
          uuid,
          invoiceName: inv.name,
          previousStatus,
          newStatus,
          changed: previousStatus !== newStatus,
          efosStatus: result.efos_status || inv.efos_status,
        });
      } catch {
        results.push({
          uuid,
          invoiceName: inv.name,
          previousStatus,
          newStatus: previousStatus,
          changed: false,
          efosStatus: inv.efos_status,
        });
      }

      setBulkProgress(i + 1);
    }

    setBulkResults(results);
    setBulkRunning(false);
    queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
  }, [payableData, receivableData, queryClient]);

  // Create payment (navigate to payments page with pre-filled data)
  const handleCreatePayment = useCallback((invoice: Invoice) => {
    const params = new URLSearchParams({
      invoice_id: String(invoice.id),
      partner_name: invoice.partner_name || "",
      partner_rfc: invoice.partner_rfc || "",
      amount: String(invoice.amount_residual ?? invoice.amount_total ?? 0),
      reference: invoice.name || "",
    });
    window.location.href = `/pagos/nuevo?${params.toString()}`;
  }, []);

  // Generate payment link
  const handlePaymentLink = useCallback(async (invoice: Invoice) => {
    try {
      const result = await api.collections.paymentLink({
        invoice_id: invoice.id,
        amount: invoice.amount_residual ?? invoice.amount_total ?? 0,
        description: `Pago factura ${invoice.name}`,
      });
      const link = result.url || result.link;
      if (link) {
        await navigator.clipboard.writeText(link);
        toast.success("Link de cobro copiado al portapapeles");
      } else {
        toast.success("Link de cobro generado");
      }
    } catch (err: any) {
      toast.error(err.message || "Error al generar link de cobro");
    }
  }, []);

  // Action handler
  const handleAction = useCallback(
    (action: string, invoice: Invoice) => {
      switch (action) {
        case "validate":
          handleValidateSingle(invoice);
          break;
        case "xml":
          setXmlInvoiceId(invoice.id);
          setXmlDialogOpen(true);
          break;
        case "create_payment":
          handleCreatePayment(invoice);
          break;
        case "payment_link":
          handlePaymentLink(invoice);
          break;
        case "complements":
          setComplementsInvoice(invoice);
          setComplementsDialogOpen(true);
          break;
        case "cancel":
          setCancelInvoice(invoice);
          setCancelDialogOpen(true);
          break;
      }
    },
    [handleValidateSingle, handleCreatePayment, handlePaymentLink]
  );

  // Row click -> detail panel
  const handleRowClick = useCallback((invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setDetailOpen(true);
  }, []);

  // Columns
  const payableColumns = useInvoiceColumns("payable", handleAction);
  const receivableColumns = useInvoiceColumns("receivable", handleAction);

  // Search handler
  const handleSearchChange = useCallback(
    (value: string) => {
      setFilters({ search: value, page: 1 });
    },
    [setFilters]
  );

  // Sync Odoo
  const handleSyncOdoo = useCallback(async () => {
    try {
      await api.sync.trigger("odoo");
      toast.success("Sincronizacion con Odoo iniciada");
      queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
    } catch (err: any) {
      toast.error(err.message || "Error al sincronizar");
    }
  }, [queryClient]);

  // Empty state
  const emptyState = (
    <EmptyState
      icon={FileText}
      title="No hay facturas"
      description="No se encontraron facturas con los filtros seleccionados. Sincroniza tu ERP para importar facturas."
      action={{ label: "Sincronizar Odoo", onClick: handleSyncOdoo }}
    />
  );

  // Toolbar
  const toolbar = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={filters.search}
          onChange={handleSearchChange}
          placeholder="Buscar por numero, proveedor, RFC, UUID..."
          className="w-full sm:w-80"
        />
        <PermissionGate permission="invoices:validate">
          <Button variant="outline" onClick={handleBulkValidation} disabled={bulkRunning}>
            {bulkRunning ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <ShieldCheck className="mr-1.5 size-4" />
            )}
            Validar Todo
          </Button>
        </PermissionGate>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
          }}
        >
          <RefreshCw className="mr-1.5 size-4" />
          Actualizar
        </Button>
      </div>
      <FilterBar
        filters={INVOICE_FILTERS}
        values={filterBarValues}
        onChange={setFilterBarValues}
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Facturas</h1>
        <p className="text-muted-foreground text-sm">
          Gestiona facturas por pagar y por cobrar. Valida CFDI contra el SAT, registra pagos y
          genera links de cobro.
        </p>
      </div>

      {/* Unvalidated Banner */}
      {unvalidatedCount > 0 && canValidate && (
        <div className="flex items-center justify-between rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-yellow-600" />
            <span className="text-sm font-medium text-yellow-800">
              Tienes {unvalidatedCount} facturas sin validar contra el SAT
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-yellow-400 text-yellow-800 hover:bg-yellow-100"
            onClick={handleBulkValidation}
            disabled={bulkRunning}
          >
            {bulkRunning ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <ShieldCheck className="mr-1.5 size-4" />
            )}
            Validar Todo
          </Button>
        </div>
      )}

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "payable" | "receivable")}
      >
        <TabsList>
          <TabsTrigger value="payable" className="gap-1.5">
            <FileText className="size-4" />
            Por Pagar
            {payableData.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs">
                {payableData.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="receivable" className="gap-1.5">
            <FileText className="size-4" />
            Por Cobrar
            {receivableData.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs">
                {receivableData.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Por Pagar */}
        <TabsContent value="payable" className="mt-4">
          <DataTable
            columns={payableColumns}
            data={filteredData}
            isLoading={payableQuery.isLoading}
            onRowClick={handleRowClick}
            emptyState={emptyState}
            toolbar={toolbar}
            pagination={{
              page: filters.page,
              pageSize: filters.per_page,
              total: filteredData.length,
            }}
            onPaginationChange={(p) =>
              setFilters({ page: p.page, per_page: p.pageSize })
            }
          />
        </TabsContent>

        {/* Por Cobrar */}
        <TabsContent value="receivable" className="mt-4">
          <DataTable
            columns={receivableColumns}
            data={filteredData}
            isLoading={receivableQuery.isLoading}
            onRowClick={handleRowClick}
            emptyState={emptyState}
            toolbar={toolbar}
            pagination={{
              page: filters.page,
              pageSize: filters.per_page,
              total: filteredData.length,
            }}
            onPaginationChange={(p) =>
              setFilters({ page: p.page, per_page: p.pageSize })
            }
          />
        </TabsContent>
      </Tabs>

      {/* Detail Panel */}
      <DetailPanel
        isOpen={detailOpen}
        onClose={() => {
          setDetailOpen(false);
          setSelectedInvoice(null);
        }}
        title={selectedInvoice?.name || "Detalle de Factura"}
        tabs={["Detalle", "Pagos", "CFDI"]}
      >
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
          <div className="py-4 space-y-4">
            <h4 className="font-semibold text-sm">Detalle CFDI</h4>
            <div className="space-y-3 text-sm">
              <div>
                <span className="text-muted-foreground">UUID:</span>
                <div className="font-mono text-xs break-all mt-0.5">
                  {selectedInvoice.cfdi_uuid || selectedInvoice.odoo_cfdi_uuid || "-"}
                </div>
              </div>
              <div>
                <span className="text-muted-foreground">Tipo Comprobante:</span>
                <div>{selectedInvoice.tipo_comprobante || "-"}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Emisor Regimen:</span>
                <div>{selectedInvoice.emisor_regimen || "-"}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Receptor Regimen:</span>
                <div>{selectedInvoice.receptor_regimen || "-"}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Lugar Expedicion:</span>
                <div>{selectedInvoice.lugar_expedicion || "-"}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Descuento:</span>
                <div>
                  {selectedInvoice.descuento != null
                    ? formatMoney(selectedInvoice.descuento)
                    : "-"}
                </div>
              </div>
              <div>
                <span className="text-muted-foreground">Semaforo SAT:</span>
                <div className="mt-1">
                  <SatSemaphore
                    satStatus={selectedInvoice.sat_status}
                    efosStatus={selectedInvoice.efos_status}
                  />
                </div>
              </div>
              {selectedInvoice.es_cancelable && (
                <div>
                  <span className="text-muted-foreground">Cancelable:</span>
                  <div>{selectedInvoice.es_cancelable}</div>
                </div>
              )}
              {selectedInvoice.estatus_cancelacion && (
                <div>
                  <span className="text-muted-foreground">Estatus Cancelacion:</span>
                  <div>{selectedInvoice.estatus_cancelacion}</div>
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setXmlInvoiceId(selectedInvoice.id);
                  setXmlDialogOpen(true);
                }}
              >
                <Eye className="mr-1.5 size-3.5" />
                Ver XML
              </Button>
              <PermissionGate permission="invoices:validate">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleValidateSingle(selectedInvoice)}
                >
                  <ShieldCheck className="mr-1.5 size-3.5" />
                  Validar SAT
                </Button>
              </PermissionGate>
            </div>
          </div>
        ) : (
          <Skeleton className="h-40 w-full" />
        )}
      </DetailPanel>

      {/* XML Dialog */}
      <XmlViewerDialog
        open={xmlDialogOpen}
        onOpenChange={setXmlDialogOpen}
        invoiceId={xmlInvoiceId}
      />

      {/* Cancellation Dialog */}
      <PermissionGate permission="invoices:cancel-cfdi">
        <CancellationDialog
          open={cancelDialogOpen}
          onOpenChange={setCancelDialogOpen}
          invoice={cancelInvoice}
        />
      </PermissionGate>

      {/* Complements Dialog */}
      <ComplementsDialog
        open={complementsDialogOpen}
        onOpenChange={setComplementsDialogOpen}
        invoice={complementsInvoice}
      />

      {/* Bulk Validation Dialog */}
      <BulkValidationDialog
        open={bulkDialogOpen}
        onOpenChange={setBulkDialogOpen}
        results={bulkResults}
        progress={bulkProgress}
        total={bulkTotal}
        isRunning={bulkRunning}
      />
    </div>
  );
}
