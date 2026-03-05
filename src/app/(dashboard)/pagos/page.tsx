"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Plus,
  CreditCard,
  MoreHorizontal,
  Play,
  Ban,
  RefreshCw,
  AlertCircle,
  Eye,
  Loader2,
} from "lucide-react";

import { Payment, Vendor, Invoice } from "@/types";
import {
  usePayments,
  useCreatePayment,
  useExecutePayment,
  useExecuteBatchPayments,
  useCancelPayment,
  useRetryPayment,
} from "@/lib/hooks/use-payments";
import { usePaymentFilters } from "@/lib/hooks/use-url-state";
import { usePermission } from "@/lib/hooks/use-permission";
import { api } from "@/lib/api";
import { createPaymentSchema } from "@/lib/utils/validation";
import { formatMoney, formatDate, formatDateTime } from "@/lib/utils/format";

import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { DetailPanel } from "@/components/shared/detail-panel";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { SearchInput } from "@/components/shared/search-input";
import { PermissionGate } from "@/components/shared/permission-gate";
import { FilterBar, type FilterConfig } from "@/components/shared/filter-bar";
import { Timeline, type TimelineEvent } from "@/components/shared/timeline";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PaymentFormValues = z.infer<typeof createPaymentSchema>;

type TabKey = "todos" | "pendientes" | "ejecutados" | "programados" | "fallidos";

const TAB_STATUS_MAP: Record<TabKey, string | undefined> = {
  todos: undefined,
  pendientes: "pending,pending_approval",
  ejecutados: "confirmed",
  programados: "scheduled",
  fallidos: "failed,rejected",
};

const FILTER_CONFIGS: FilterConfig[] = [
  {
    key: "date",
    label: "Fecha",
    type: "date-range",
  },
];

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

function getColumns(opts: {
  onRowAction: (action: string, payment: Payment) => void;
  canExecute: boolean;
  canCancel: boolean;
}): ColumnDef<Payment, unknown>[] {
  return [
    {
      accessorKey: "created_at",
      header: "Fecha",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {row.original.created_at ? formatDate(row.original.created_at) : "-"}
        </span>
      ),
      size: 110,
    },
    {
      accessorKey: "partner_name",
      header: "Proveedor",
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-sm">
            {row.original.partner_name || "-"}
          </p>
          {row.original.partner_rfc && (
            <p className="truncate text-xs text-muted-foreground">
              {row.original.partner_rfc}
            </p>
          )}
        </div>
      ),
      size: 200,
    },
    {
      accessorKey: "reference_id",
      header: "Concepto",
      cell: ({ row }) => {
        const val = row.original.reference_id || "-";
        const truncated = val.length > 40 ? val.slice(0, 40) + "..." : val;
        return (
          <span className="text-sm text-muted-foreground" title={val}>
            {truncated}
          </span>
        );
      },
      size: 220,
    },
    {
      accessorKey: "amount",
      header: () => <span className="block text-right">Monto</span>,
      cell: ({ row }) => (
        <span className="block text-right font-mono text-sm font-medium">
          {formatMoney(row.original.amount)}
        </span>
      ),
      size: 140,
    },
    {
      id: "clabe",
      header: "CLABE",
      cell: ({ row }) => {
        const clabe = row.original.clabe_destination;
        if (!clabe) return <span className="text-sm text-muted-foreground">-</span>;
        return (
          <span className="font-mono text-sm text-muted-foreground">
            ****{clabe.slice(-4)}
          </span>
        );
      },
      size: 90,
    },
    {
      accessorKey: "status",
      header: "Estado",
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
      size: 130,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const p = row.original;
        const isPending = p.status === "pending" || p.status === "pending_approval";
        const isFailed = p.status === "failed" || p.status === "rejected";

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
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  opts.onRowAction("view", p);
                }}
              >
                <Eye className="mr-2 size-4" />
                Ver detalle
              </DropdownMenuItem>

              {isPending && opts.canExecute && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    opts.onRowAction("execute", p);
                  }}
                >
                  <Play className="mr-2 size-4" />
                  Ejecutar
                </DropdownMenuItem>
              )}

              {isPending && opts.canCancel && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      opts.onRowAction("cancel", p);
                    }}
                  >
                    <Ban className="mr-2 size-4" />
                    Cancelar
                  </DropdownMenuItem>
                </>
              )}

              {isFailed && opts.canExecute && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    opts.onRowAction("retry", p);
                  }}
                >
                  <RefreshCw className="mr-2 size-4" />
                  Reintentar
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
      size: 50,
      enableSorting: false,
    },
  ];
}

// ---------------------------------------------------------------------------
// NewPaymentDialog
// ---------------------------------------------------------------------------

function NewPaymentDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createPayment = useCreatePayment();
  const form = useForm<PaymentFormValues>({
    resolver: zodResolver(createPaymentSchema),
    defaultValues: {
      vendor_name: "",
      concept: "",
      clabe: "",
      amount: 0,
      reference: "",
      scheduled_date: "",
    },
  });

  // Vendor combobox state
  const [vendorSearch, setVendorSearch] = useState("");
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [showVendorDropdown, setShowVendorDropdown] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const vendorDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Invoice state
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);

  // Concept counter
  const conceptValue = form.watch("concept");
  const conceptLen = conceptValue?.length || 0;

  // Debounced vendor search
  useEffect(() => {
    if (!open) return;
    if (vendorDebounce.current) clearTimeout(vendorDebounce.current);
    vendorDebounce.current = setTimeout(() => {
      api.vendors
        .list({ search: vendorSearch })
        .then((v) => setVendors(Array.isArray(v) ? v : []))
        .catch(() => setVendors([]));
    }, 300);
    return () => {
      if (vendorDebounce.current) clearTimeout(vendorDebounce.current);
    };
  }, [vendorSearch, open]);

  // Load vendor invoices
  useEffect(() => {
    if (!selectedVendor) {
      setInvoices([]);
      return;
    }
    setLoadingInvoices(true);
    api.invoices
      .payable({ partner_name: selectedVendor.name })
      .then((inv) => setInvoices(Array.isArray(inv) ? inv : []))
      .catch(() => setInvoices([]))
      .finally(() => setLoadingInvoices(false));
  }, [selectedVendor]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowVendorDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function selectVendor(v: Vendor) {
    setSelectedVendor(v);
    setVendorSearch(v.name || "");
    setShowVendorDropdown(false);
    form.setValue("vendor_name", v.name || "");
    form.setValue("vendor_id", v.id);
    if (v.clabe) {
      form.setValue("clabe", v.clabe);
    }
  }

  function selectInvoice(inv: Invoice) {
    form.setValue("invoice_id", inv.id);
    if (inv.amount_residual) {
      form.setValue("amount", inv.amount_residual);
    }
  }

  function resetDialog() {
    form.reset();
    setVendorSearch("");
    setSelectedVendor(null);
    setVendors([]);
    setInvoices([]);
    setShowVendorDropdown(false);
  }

  async function onSubmit(data: PaymentFormValues) {
    await createPayment.mutateAsync({
      vendor_id: data.vendor_id,
      vendor_name: data.vendor_name,
      invoice_id: data.invoice_id,
      amount: data.amount,
      clabe_destination: data.clabe,
      concept: data.concept,
      reference_id: data.reference || undefined,
      scheduled_date: data.scheduled_date || undefined,
    });
    resetDialog();
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        if (!val) resetDialog();
        onOpenChange(val);
      }}
    >
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo Pago</DialogTitle>
          <DialogDescription>
            Ingresa los datos para realizar un pago a proveedor via SPEI.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 py-2">
          {/* Vendor combobox */}
          <div className="grid gap-2 relative" ref={dropdownRef}>
            <Label>Proveedor *</Label>
            <Input
              placeholder="Buscar proveedor por nombre o RFC..."
              value={vendorSearch}
              onChange={(e) => {
                setVendorSearch(e.target.value);
                setSelectedVendor(null);
                form.setValue("vendor_name", e.target.value);
                form.setValue("vendor_id", undefined);
                setShowVendorDropdown(true);
              }}
              onFocus={() => setShowVendorDropdown(true)}
              autoComplete="off"
            />
            {form.formState.errors.vendor_name && (
              <p className="text-xs text-destructive">
                {form.formState.errors.vendor_name.message}
              </p>
            )}
            {showVendorDropdown && vendors.length > 0 && (
              <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-48 overflow-y-auto rounded-md border bg-popover shadow-md">
                {vendors.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-accent text-left"
                    onClick={() => selectVendor(v)}
                  >
                    <div>
                      <span className="font-medium">{v.name}</span>
                      {v.rfc && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {v.rfc}
                        </span>
                      )}
                    </div>
                    {v.clabe && (
                      <span className="text-xs text-muted-foreground font-mono">
                        ****{v.clabe.slice(-4)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Invoice select (optional) */}
          {selectedVendor && (
            <div className="grid gap-2">
              <Label>Factura (opcional)</Label>
              {loadingInvoices ? (
                <Skeleton className="h-9 w-full" />
              ) : invoices.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Sin facturas por pagar para este proveedor.
                </p>
              ) : (
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  defaultValue=""
                  onChange={(e) => {
                    const inv = invoices.find(
                      (i) => i.id === Number(e.target.value)
                    );
                    if (inv) selectInvoice(inv);
                  }}
                >
                  <option value="">Seleccionar factura...</option>
                  {invoices.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.name} - {formatMoney(inv.amount_residual || 0)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Amount */}
          <div className="grid gap-2">
            <Label>Monto (MXN) *</Label>
            <Controller
              control={form.control}
              name="amount"
              render={({ field }) => (
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  value={field.value || ""}
                  onChange={(e) =>
                    field.onChange(
                      e.target.value ? parseFloat(e.target.value) : 0
                    )
                  }
                />
              )}
            />
            {form.formState.errors.amount && (
              <p className="text-xs text-destructive">
                {form.formState.errors.amount.message}
              </p>
            )}
          </div>

          {/* CLABE */}
          <div className="grid gap-2">
            <Label>CLABE destino *</Label>
            <Controller
              control={form.control}
              name="clabe"
              render={({ field }) => (
                <Input
                  placeholder="18 digitos"
                  maxLength={18}
                  value={field.value}
                  onChange={(e) =>
                    field.onChange(
                      e.target.value.replace(/\D/g, "").slice(0, 18)
                    )
                  }
                  className="font-mono tracking-wider"
                />
              )}
            />
            {selectedVendor?.clabe &&
              form.getValues("clabe") === selectedVendor.clabe && (
                <p className="text-xs text-muted-foreground">
                  Auto-llenado del proveedor seleccionado
                </p>
              )}
            {form.formState.errors.clabe && (
              <p className="text-xs text-destructive">
                {form.formState.errors.clabe.message}
              </p>
            )}
          </div>

          {/* Concepto */}
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>Concepto *</Label>
              <span
                className={`text-xs ${
                  conceptLen > 40
                    ? "text-destructive"
                    : "text-muted-foreground"
                }`}
              >
                {conceptLen}/40
              </span>
            </div>
            <Input
              placeholder="Concepto del pago (max 40 caracteres SPEI)"
              maxLength={40}
              {...form.register("concept")}
            />
            {form.formState.errors.concept && (
              <p className="text-xs text-destructive">
                {form.formState.errors.concept.message}
              </p>
            )}
          </div>

          {/* Reference */}
          <div className="grid gap-2">
            <Label>Referencia numerica (opcional)</Label>
            <Controller
              control={form.control}
              name="reference"
              render={({ field }) => (
                <Input
                  placeholder="Max 7 digitos"
                  maxLength={7}
                  value={field.value || ""}
                  onChange={(e) =>
                    field.onChange(
                      e.target.value.replace(/\D/g, "").slice(0, 7)
                    )
                  }
                  className="font-mono"
                />
              )}
            />
            {form.formState.errors.reference && (
              <p className="text-xs text-destructive">
                {form.formState.errors.reference.message}
              </p>
            )}
          </div>

          {/* Scheduled date */}
          <div className="grid gap-2">
            <Label>Fecha programada (opcional)</Label>
            <Input type="date" {...form.register("scheduled_date")} />
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                resetDialog();
                onOpenChange(false);
              }}
              disabled={createPayment.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={createPayment.isPending}>
              {createPayment.isPending && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Crear Pago
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// PaymentDetailPanel
// ---------------------------------------------------------------------------

function PaymentDetailPanel({
  payment,
  isOpen,
  onClose,
}: {
  payment: Payment | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  if (!payment) return null;

  const timelineEvents: TimelineEvent[] = [];

  if (payment.created_at) {
    timelineEvents.push({
      date: payment.created_at,
      label: "Pago creado",
      description: `Monto: ${formatMoney(payment.amount)}`,
      active: payment.status === "pending" || payment.status === "pending_approval",
    });
  }

  if (
    payment.status === "confirmed" ||
    payment.status === "processing" ||
    payment.status === "failed"
  ) {
    timelineEvents.push({
      date: payment.executed_at || payment.created_at || new Date().toISOString(),
      label: "Pago ejecutado",
      description: payment.fintoc_transfer_id
        ? `Transfer ID: ${payment.fintoc_transfer_id}`
        : "Enviado via SPEI",
      active: payment.status === "processing",
    });
  }

  if (payment.status === "confirmed") {
    timelineEvents.push({
      date: payment.executed_at || payment.created_at || new Date().toISOString(),
      label: "Pago confirmado",
      description: "Confirmado por Fintoc",
      active: true,
    });
  }

  if (payment.status === "failed" || payment.status === "rejected") {
    timelineEvents.push({
      date: payment.executed_at || payment.created_at || new Date().toISOString(),
      label:
        payment.status === "rejected" ? "Pago rechazado" : "Pago fallido",
      description: "El pago no pudo completarse",
      active: true,
    });
  }

  return (
    <DetailPanel
      isOpen={isOpen}
      onClose={onClose}
      title={`Pago #${payment.id}`}
      tabs={["Detalle", "Timeline", "Audit Log"]}
    >
      {/* Tab: Detalle */}
      <div className="space-y-4 pt-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Proveedor</p>
            <p className="text-sm font-medium">
              {payment.partner_name || "-"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">RFC</p>
            <p className="text-sm font-medium font-mono">
              {payment.partner_rfc || "-"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Monto</p>
            <p className="text-sm font-medium font-mono">
              {formatMoney(payment.amount)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Estado</p>
            <StatusBadge status={payment.status} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">CLABE destino</p>
            <p className="text-sm font-mono">
              {payment.clabe_destination || "-"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Referencia</p>
            <p className="text-sm">{payment.reference_id || "-"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Fecha creacion</p>
            <p className="text-sm">
              {payment.created_at
                ? formatDateTime(payment.created_at)
                : "-"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Fecha ejecucion</p>
            <p className="text-sm">
              {payment.executed_at
                ? formatDateTime(payment.executed_at)
                : "-"}
            </p>
          </div>
        </div>

        {payment.fintoc_transfer_id && (
          <div>
            <p className="text-xs text-muted-foreground">Fintoc Transfer ID</p>
            <p className="text-sm font-mono">{payment.fintoc_transfer_id}</p>
          </div>
        )}

        {payment.fintoc_payment_intent_id && (
          <div>
            <p className="text-xs text-muted-foreground">
              Fintoc Payment Intent ID
            </p>
            <p className="text-sm font-mono">
              {payment.fintoc_payment_intent_id}
            </p>
          </div>
        )}

        {payment.cfdi_uuid && (
          <div>
            <p className="text-xs text-muted-foreground">CFDI UUID</p>
            <p className="text-sm font-mono">{payment.cfdi_uuid}</p>
          </div>
        )}

        {payment.odoo_id && (
          <div className="flex gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Odoo ID</p>
              <p className="text-sm">{payment.odoo_id}</p>
            </div>
            {payment.odoo_state && (
              <div>
                <p className="text-xs text-muted-foreground">Odoo Estado</p>
                <p className="text-sm">{payment.odoo_state}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tab: Timeline */}
      <div className="pt-4">
        {timelineEvents.length > 0 ? (
          <Timeline events={timelineEvents} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Sin eventos registrados.
          </p>
        )}
      </div>

      {/* Tab: Audit Log */}
      <div className="pt-4">
        <div className="space-y-3">
          {payment.created_at && (
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <p className="text-sm font-medium">Pago creado</p>
                <p className="text-xs text-muted-foreground">
                  {payment.partner_name} - {formatMoney(payment.amount)}
                </p>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {formatDateTime(payment.created_at)}
              </span>
            </div>
          )}
          {payment.executed_at && (
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <p className="text-sm font-medium">Pago ejecutado</p>
                <p className="text-xs text-muted-foreground">
                  Estado: {payment.status}
                </p>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {formatDateTime(payment.executed_at)}
              </span>
            </div>
          )}
          {payment.jws_signed && (
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <p className="text-sm font-medium">Firma JWS aplicada</p>
                <p className="text-xs text-muted-foreground">
                  Pago firmado digitalmente
                </p>
              </div>
            </div>
          )}
          {payment.complemento_emitido && (
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <p className="text-sm font-medium">Complemento de pago emitido</p>
                {payment.complemento_uuid && (
                  <p className="text-xs text-muted-foreground font-mono">
                    UUID: {payment.complemento_uuid}
                  </p>
                )}
              </div>
            </div>
          )}
          {!payment.created_at && !payment.executed_at && (
            <p className="text-sm text-muted-foreground">
              Sin registros de auditoria.
            </p>
          )}
        </div>
      </div>
    </DetailPanel>
  );
}

// ---------------------------------------------------------------------------
// BatchExecutionBar
// ---------------------------------------------------------------------------

function BatchExecutionBar({
  selectedPayments,
  onExecute,
  isExecuting,
  batchProgress,
  batchTotal,
}: {
  selectedPayments: Payment[];
  onExecute: () => void;
  isExecuting: boolean;
  batchProgress: number;
  batchTotal: number;
}) {
  const total = selectedPayments.reduce((sum, p) => sum + p.amount, 0);

  if (selectedPayments.length === 0) return null;

  return (
    <div className="flex items-center gap-4 rounded-lg border bg-muted/50 px-4 py-3">
      <Badge variant="secondary">
        {selectedPayments.length} pagos seleccionados
      </Badge>
      <span className="text-sm font-medium">
        Total: {formatMoney(total)}
      </span>

      {isExecuting ? (
        <div className="flex items-center gap-3 ml-auto min-w-[200px]">
          <Progress
            value={batchTotal > 0 ? (batchProgress / batchTotal) * 100 : 0}
            className="flex-1"
          />
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            Procesando {batchProgress}/{batchTotal}...
          </span>
        </div>
      ) : (
        <PermissionGate permission="payments:execute">
          <Button size="sm" className="ml-auto" onClick={onExecute}>
            <Play className="mr-2 size-4" />
            Ejecutar Seleccionados
          </Button>
        </PermissionGate>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function PagosPage() {
  // URL state
  const [filters, setFilters] = usePaymentFilters();

  // Local UI state
  const [activeTab, setActiveTab] = useState<TabKey>("todos");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Payment[]>([]);

  // Confirm dialogs
  const [executeConfirm, setExecuteConfirm] = useState<Payment | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState<Payment | null>(null);
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);

  // Batch execution progress
  const [batchExecuting, setBatchExecuting] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);

  // Permissions
  const canCreate = usePermission("payments:create");
  const canExecute = usePermission("payments:execute");
  const canCancel = usePermission("payments:cancel");

  // Build query filters
  const queryFilters = useMemo(() => {
    const f: Record<string, unknown> = {};
    const statusFromTab = TAB_STATUS_MAP[activeTab];
    if (statusFromTab) f.status = statusFromTab;
    if (filters.search) f.search = filters.search;
    if (filters.date_from) f.date_from = filters.date_from;
    if (filters.date_to) f.date_to = filters.date_to;
    f.page = filters.page;
    f.per_page = filters.per_page;
    return f;
  }, [activeTab, filters]);

  // Data fetching
  const {
    data: paymentsResponse,
    isLoading,
    isError,
    error,
    refetch,
  } = usePayments(queryFilters);

  const payments: Payment[] = useMemo(() => {
    if (!paymentsResponse) return [];
    if (Array.isArray(paymentsResponse)) return paymentsResponse;
    if (paymentsResponse.data) return paymentsResponse.data;
    if (paymentsResponse.items) return paymentsResponse.items;
    return [];
  }, [paymentsResponse]);

  const totalCount = useMemo(() => {
    if (!paymentsResponse) return 0;
    if (Array.isArray(paymentsResponse)) return paymentsResponse.length;
    return paymentsResponse.total ?? paymentsResponse.count ?? payments.length;
  }, [paymentsResponse, payments.length]);

  // Mutations
  const executePayment = useExecutePayment();
  const executeBatch = useExecuteBatchPayments();
  const cancelPayment = useCancelPayment();
  const retryPayment = useRetryPayment();

  // Column definitions
  const columns = useMemo(
    () =>
      getColumns({
        onRowAction: handleRowAction,
        canExecute,
        canCancel,
      }),
    [canExecute, canCancel]
  );

  // Handlers
  function handleRowAction(action: string, payment: Payment) {
    switch (action) {
      case "view":
        setSelectedPayment(payment);
        setDetailOpen(true);
        break;
      case "execute":
        setExecuteConfirm(payment);
        break;
      case "cancel":
        setCancelConfirm(payment);
        break;
      case "retry":
        retryPayment.mutate(payment.id);
        break;
    }
  }

  function handleRowClick(payment: Payment) {
    setSelectedPayment(payment);
    setDetailOpen(true);
  }

  async function handleConfirmExecute() {
    if (!executeConfirm) return;
    await executePayment.mutateAsync(executeConfirm.id);
    setExecuteConfirm(null);
  }

  async function handleConfirmCancel() {
    if (!cancelConfirm) return;
    await cancelPayment.mutateAsync(cancelConfirm.id);
    setCancelConfirm(null);
  }

  async function handleBatchExecute() {
    setBatchConfirmOpen(false);
    const ids = selectedRows.map((p) => p.id);
    setBatchTotal(ids.length);
    setBatchProgress(0);
    setBatchExecuting(true);

    try {
      // Try batch endpoint first
      await executeBatch.mutateAsync(ids);
      setBatchProgress(ids.length);
    } catch {
      // Fallback: execute one by one for progress tracking
      for (let i = 0; i < ids.length; i++) {
        try {
          await api.payments.execute({ payment_id: ids[i] });
        } catch {
          // continue with rest
        }
        setBatchProgress(i + 1);
      }
    } finally {
      setBatchExecuting(false);
      setBatchProgress(0);
      setBatchTotal(0);
      setSelectedRows([]);
      refetch();
    }
  }

  const handleSearchChange = useCallback(
    (value: string) => {
      setFilters({ search: value, page: 1 });
    },
    [setFilters]
  );

  const handleFilterChange = useCallback(
    (values: Record<string, string>) => {
      setFilters({
        date_from: values.date_from || "",
        date_to: values.date_to || "",
        page: 1,
      });
    },
    [setFilters]
  );

  const handleTabChange = useCallback(
    (tab: string) => {
      setActiveTab(tab as TabKey);
      setFilters({ page: 1 });
      setSelectedRows([]);
    },
    [setFilters]
  );

  const handlePaginationChange = useCallback(
    (pagination: { page: number; pageSize: number; total: number }) => {
      setFilters({ page: pagination.page });
    },
    [setFilters]
  );

  // Pending payments for batch selection
  const showBatchBar =
    activeTab === "pendientes" || activeTab === "todos";

  const pendingSelected = selectedRows.filter(
    (p) => p.status === "pending" || p.status === "pending_approval"
  );

  // Toolbar
  const toolbar = (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-2">
        <PermissionGate permission="payments:create">
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 size-4" />
            Nuevo Pago
          </Button>
        </PermissionGate>
      </div>

      <div className="flex items-center gap-3 flex-1 justify-center">
        <SearchInput
          value={filters.search}
          onChange={handleSearchChange}
          placeholder="Buscar por proveedor, referencia..."
          className="w-full max-w-sm"
        />
      </div>

      <FilterBar
        filters={FILTER_CONFIGS}
        values={{
          date_from: filters.date_from,
          date_to: filters.date_to,
        }}
        onChange={handleFilterChange}
      />
    </div>
  );

  // Empty state
  const emptyState = (
    <EmptyState
      icon={CreditCard}
      title="No hay pagos"
      description="Crea tu primer pago a proveedor para empezar a gestionar tus transferencias SPEI."
      action={
        canCreate
          ? {
              label: "Nuevo Pago",
              onClick: () => setDialogOpen(true),
            }
          : undefined
      }
    />
  );

  // Error state
  if (isError) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader onNewPayment={() => setDialogOpen(true)} />
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="rounded-full bg-destructive/10 p-4">
            <AlertCircle className="size-8 text-destructive" />
          </div>
          <h3 className="mt-4 text-lg font-semibold">Error al cargar pagos</h3>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {(error as Error)?.message || "Ocurrio un error inesperado."}
          </p>
          <Button className="mt-4" variant="outline" onClick={() => refetch()}>
            <RefreshCw className="mr-2 size-4" />
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader onNewPayment={() => setDialogOpen(true)} />

      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
      >
        <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
          <TabsList>
            <TabsTrigger value="todos">Todos</TabsTrigger>
            <TabsTrigger value="pendientes">Pendientes</TabsTrigger>
            <TabsTrigger value="ejecutados">Ejecutados</TabsTrigger>
            <TabsTrigger value="programados">Programados</TabsTrigger>
            <TabsTrigger value="fallidos">Fallidos</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value={activeTab} className="mt-4">
          {/* Batch execution bar */}
          {showBatchBar && (
            <BatchExecutionBar
              selectedPayments={pendingSelected}
              onExecute={() => setBatchConfirmOpen(true)}
              isExecuting={batchExecuting}
              batchProgress={batchProgress}
              batchTotal={batchTotal}
            />
          )}

          <DataTable
            columns={columns}
            data={payments}
            isLoading={isLoading}
            selectable={showBatchBar}
            onSelectionChange={setSelectedRows}
            onRowClick={handleRowClick}
            emptyState={emptyState}
            toolbar={toolbar}
            pagination={{
              page: filters.page,
              pageSize: filters.per_page,
              total: totalCount,
            }}
            onPaginationChange={handlePaginationChange}
          />
        </TabsContent>
      </Tabs>

      {/* Detail Panel */}
      <PaymentDetailPanel
        payment={selectedPayment}
        isOpen={detailOpen}
        onClose={() => {
          setDetailOpen(false);
          setSelectedPayment(null);
        }}
      />

      {/* New Payment Dialog */}
      <NewPaymentDialog open={dialogOpen} onOpenChange={setDialogOpen} />

      {/* Execute Confirm Dialog */}
      <ConfirmDialog
        open={!!executeConfirm}
        onOpenChange={(open) => !open && setExecuteConfirm(null)}
        title="Confirmar ejecucion de pago"
        description={
          executeConfirm
            ? `Confirmas enviar ${formatMoney(executeConfirm.amount)} a ${executeConfirm.partner_name || "proveedor"} via SPEI? Esta accion no se puede deshacer.`
            : ""
        }
        confirmLabel="Ejecutar Pago"
        onConfirm={handleConfirmExecute}
        loading={executePayment.isPending}
      />

      {/* Cancel Confirm Dialog */}
      <ConfirmDialog
        open={!!cancelConfirm}
        onOpenChange={(open) => !open && setCancelConfirm(null)}
        title="Cancelar pago"
        description={
          cancelConfirm
            ? `Estas seguro de cancelar el pago de ${formatMoney(cancelConfirm.amount)} a ${cancelConfirm.partner_name || "proveedor"}?`
            : ""
        }
        confirmLabel="Cancelar Pago"
        variant="destructive"
        onConfirm={handleConfirmCancel}
        loading={cancelPayment.isPending}
      />

      {/* Batch Execute Confirm Dialog */}
      <ConfirmDialog
        open={batchConfirmOpen}
        onOpenChange={setBatchConfirmOpen}
        title="Ejecutar pagos seleccionados"
        description={`Confirmas ejecutar ${pendingSelected.length} pagos por un total de ${formatMoney(
          pendingSelected.reduce((s, p) => s + p.amount, 0)
        )} via SPEI? Esta accion no se puede deshacer.`}
        confirmLabel={`Ejecutar ${pendingSelected.length} pagos`}
        onConfirm={handleBatchExecute}
        loading={batchExecuting}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PageHeader
// ---------------------------------------------------------------------------

function PageHeader({ onNewPayment }: { onNewPayment: () => void }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Pagos</h1>
        <p className="text-sm text-muted-foreground">
          Gestiona pagos a proveedores y transferencias SPEI.
        </p>
      </div>
      <PermissionGate permission="payments:create">
        <Button onClick={onNewPayment} className="sm:hidden">
          <Plus className="mr-2 size-4" />
          Nuevo Pago
        </Button>
      </PermissionGate>
    </div>
  );
}
