"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Receipt,
  Clock,
  AlertTriangle,
  BarChart3,
  Link2,
  Mail,
  CreditCard,
  Eye,
  Copy,
  Loader2,
  Timer,
} from "lucide-react";

import { api } from "@/lib/api";
import { formatMoney, formatDate } from "@/lib/utils/format";
import type { Invoice } from "@/types";

import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { KpiCard } from "@/components/shared/kpi-card";
import { SearchInput } from "@/components/shared/search-input";
import { PermissionGate } from "@/components/shared/permission-gate";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/* ---------- helpers ---------- */

function daysOverdue(dateStr?: string): number {
  if (!dateStr) return 0;
  const due = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor(
    (now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)
  );
  return diff > 0 ? diff : 0;
}

function agingBucket(days: number): string {
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

/* ---------- Aging bucket type ---------- */

interface AgingBucket {
  bucket: string;
  count: number;
  total: number;
}

/* ---------- PaymentLinkDialog ---------- */

function PaymentLinkDialog({
  open,
  onOpenChange,
  invoice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: Invoice | null;
}) {
  const [generatedUrl, setGeneratedUrl] = useState("");

  const generateMutation = useMutation({
    mutationFn: (data: { partner_id: string; amount: number }) =>
      api.collections.paymentLink(data),
    onSuccess: (result: Record<string, unknown>) => {
      setGeneratedUrl((result.payment_url as string) || (result.url as string) || "");
      toast.success("Link de pago generado");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Error al generar link de pago");
    },
  });

  function handleGenerate() {
    if (!invoice) return;
    generateMutation.mutate({
      partner_id: invoice.id,
      amount: invoice.amount_residual ?? invoice.amount_total ?? 0,
    });
  }

  function handleCopy() {
    navigator.clipboard.writeText(generatedUrl);
    toast.success("URL copiada al portapapeles");
  }

  function handleClose() {
    setGeneratedUrl("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Generar Link de Pago</DialogTitle>
          <DialogDescription>
            {invoice
              ? `Link de pago para ${invoice.partner_name || "cliente"} - ${invoice.name}`
              : "Crea un link de pago para enviar a tu cliente."}
          </DialogDescription>
        </DialogHeader>

        {generatedUrl ? (
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>URL de pago</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={generatedUrl}
                  readOnly
                  className="font-mono text-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleCopy}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Cerrar
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="grid gap-4 py-2">
            {invoice && (
              <div className="rounded-md border p-3 text-sm space-y-1">
                <p>
                  <span className="text-muted-foreground">Cliente:</span>{" "}
                  {invoice.partner_name}
                </p>
                <p>
                  <span className="text-muted-foreground">Factura:</span>{" "}
                  {invoice.name}
                </p>
                <p>
                  <span className="text-muted-foreground">Monto:</span>{" "}
                  {formatMoney(invoice.amount_residual ?? invoice.amount_total ?? 0)}
                </p>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Cancelar
              </Button>
              <Button
                onClick={handleGenerate}
                disabled={generateMutation.isPending}
              >
                {generateMutation.isPending && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                Generar Link
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------- ManualPaymentDialog ---------- */

function ManualPaymentDialog({
  open,
  onOpenChange,
  invoice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: Invoice | null;
}) {
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");

  const registerMutation = useMutation({
    mutationFn: (data: { invoice_id: number | string; amount: number; reference?: string }) =>
      api.collections.recordPayment(data),
    onSuccess: () => {
      toast.success("Pago registrado exitosamente");
      setAmount("");
      setReference("");
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Error al registrar pago");
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!invoice || !amount) return;
    registerMutation.mutate({
      invoice_id: invoice.id,
      amount: parseFloat(amount),
      reference: reference || undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar Pago Manual</DialogTitle>
          <DialogDescription>
            Registra un pago recibido para {invoice?.name || "esta factura"}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>Monto (MXN)</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>Referencia</Label>
            <Input
              placeholder="Referencia del pago"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={registerMutation.isPending || !amount}>
              {registerMutation.isPending && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Registrar Pago
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Main Page ---------- */

export default function CobranzaPage() {
  const [search, setSearch] = useState("");
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [manualPayDialogOpen, setManualPayDialogOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [activeTab, setActiveTab] = useState("pendientes");

  // TanStack Query
  const pendingQuery = useQuery({
    queryKey: ["collections", "pending"],
    queryFn: () => api.collections.pending(),
    staleTime: 30_000,
  });

  const overdueQuery = useQuery({
    queryKey: ["collections", "overdue"],
    queryFn: () => api.collections.overdue(),
    staleTime: 30_000,
  });

  const agingQuery = useQuery({
    queryKey: ["collections", "aging"],
    queryFn: () => api.collections.aging(),
    staleTime: 30_000,
  });

  const sendReminderMutation = useMutation({
    mutationFn: (data: { invoice_id: string }) =>
      api.collections.sendReminder(data),
    onSuccess: () => toast.success("Recordatorio enviado"),
    onError: (err: Error) =>
      toast.error(err.message || "Error al enviar recordatorio"),
  });

  // Filtered data
  const filteredPending = useMemo(() => {
    const data = (pendingQuery.data ?? []) as Invoice[];
    if (!search) return data;
    const q = search.toLowerCase();
    return data.filter(
      (inv) =>
        inv.partner_name?.toLowerCase().includes(q) ||
        inv.name?.toLowerCase().includes(q) ||
        inv.partner_rfc?.toLowerCase().includes(q)
    );
  }, [pendingQuery.data, search]);

  const filteredOverdue = useMemo(() => {
    const data = (overdueQuery.data ?? []) as Invoice[];
    if (!search) return data;
    const q = search.toLowerCase();
    return data.filter(
      (inv) =>
        inv.partner_name?.toLowerCase().includes(q) ||
        inv.name?.toLowerCase().includes(q) ||
        inv.partner_rfc?.toLowerCase().includes(q)
    );
  }, [overdueQuery.data, search]);

  // Aging buckets
  const agingBuckets = useMemo((): AgingBucket[] => {
    const raw = agingQuery.data;
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === "object") {
      return Object.entries(raw).map(([bucket, value]: [string, unknown]) => {
        const v = value as Record<string, unknown> | undefined;
        return {
          bucket,
          count: (v?.count as number) ?? 0,
          total: (v?.total as number) ?? (value as number) ?? 0,
        };
      });
    }
    // Compute from overdue data if API returns nothing structured
    const overdue = (overdueQuery.data ?? []) as Invoice[];
    const bucketMap: Record<string, AgingBucket> = {
      "0-30 dias": { bucket: "0-30 dias", count: 0, total: 0 },
      "31-60 dias": { bucket: "31-60 dias", count: 0, total: 0 },
      "61-90 dias": { bucket: "61-90 dias", count: 0, total: 0 },
      "90+ dias": { bucket: "90+ dias", count: 0, total: 0 },
    };
    overdue.forEach((inv) => {
      const days = daysOverdue(inv.date_due);
      const key = agingBucket(days) + " dias";
      const b = bucketMap[key];
      if (b) {
        b.count += 1;
        b.total += inv.amount_residual ?? inv.amount_total ?? 0;
      }
    });
    return Object.values(bucketMap);
  }, [agingQuery.data, overdueQuery.data]);

  // Actions
  const handlePaymentLink = useCallback((invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setLinkDialogOpen(true);
  }, []);

  const handleReminder = useCallback((invoice: Invoice) => {
    sendReminderMutation.mutate({ invoice_id: invoice.id });
  }, [sendReminderMutation]);

  const handleManualPayment = useCallback((invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setManualPayDialogOpen(true);
  }, []);

  // Actions column renderer
  const ActionsCell = useCallback(({ invoice }: { invoice: Invoice }) => {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            Acciones
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => handlePaymentLink(invoice)}>
            <Link2 className="mr-2 size-4" />
            Generar Link de Pago
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleReminder(invoice)}>
            <Mail className="mr-2 size-4" />
            Enviar Recordatorio
          </DropdownMenuItem>
          <PermissionGate permission="payments:create">
            <DropdownMenuItem onClick={() => handleManualPayment(invoice)}>
              <CreditCard className="mr-2 size-4" />
              Registrar Pago Manual
            </DropdownMenuItem>
          </PermissionGate>
          <DropdownMenuItem>
            <Eye className="mr-2 size-4" />
            Ver Detalle
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }, [handlePaymentLink, handleReminder, handleManualPayment]);

  // Columns for Pendientes
  const pendingColumns: ColumnDef<Invoice>[] = useMemo(
    () => [
      {
        accessorKey: "partner_name",
        header: "Cliente",
        cell: ({ row }) => (
          <span className="font-medium">
            {row.original.partner_name || "-"}
          </span>
        ),
      },
      {
        accessorKey: "partner_rfc",
        header: "RFC",
        cell: ({ row }) => (
          <span className="font-mono text-sm">
            {row.original.partner_rfc || "-"}
          </span>
        ),
      },
      {
        accessorKey: "name",
        header: "Factura #",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name}</span>
        ),
      },
      {
        accessorKey: "amount_total",
        header: "Monto Total",
        cell: ({ row }) => (
          <span className="font-mono text-right">
            {formatMoney(row.original.amount_total ?? 0)}
          </span>
        ),
      },
      {
        accessorKey: "amount_residual",
        header: "Saldo Pendiente",
        cell: ({ row }) => (
          <span className="font-mono font-semibold">
            {formatMoney(row.original.amount_residual ?? 0)}
          </span>
        ),
      },
      {
        accessorKey: "date_invoice",
        header: "Fecha Emision",
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.date_invoice
              ? formatDate(row.original.date_invoice)
              : "-"}
          </span>
        ),
      },
      {
        accessorKey: "date_due",
        header: "Vencimiento",
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.date_due ? formatDate(row.original.date_due) : "-"}
          </span>
        ),
      },
      {
        id: "estado",
        header: "Estado",
        cell: ({ row }) => {
          const status = row.original.payment_state || row.original.status || "pending";
          return <StatusBadge status={status} />;
        },
      },
      {
        id: "acciones",
        header: "Acciones",
        enableSorting: false,
        cell: ({ row }) => <ActionsCell invoice={row.original} />,
      },
    ],
    [ActionsCell]
  );

  // Columns for Vencidas (adds Dias Vencido column)
  const overdueColumns: ColumnDef<Invoice>[] = useMemo(
    () => [
      {
        accessorKey: "partner_name",
        header: "Cliente",
        cell: ({ row }) => (
          <span className="font-medium">
            {row.original.partner_name || "-"}
          </span>
        ),
      },
      {
        accessorKey: "partner_rfc",
        header: "RFC",
        cell: ({ row }) => (
          <span className="font-mono text-sm">
            {row.original.partner_rfc || "-"}
          </span>
        ),
      },
      {
        accessorKey: "name",
        header: "Factura #",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name}</span>
        ),
      },
      {
        accessorKey: "amount_total",
        header: "Monto Total",
        cell: ({ row }) => (
          <span className="font-mono">
            {formatMoney(row.original.amount_total ?? 0)}
          </span>
        ),
      },
      {
        accessorKey: "amount_residual",
        header: "Saldo Pendiente",
        cell: ({ row }) => (
          <span className="font-mono font-semibold">
            {formatMoney(row.original.amount_residual ?? 0)}
          </span>
        ),
      },
      {
        accessorKey: "date_invoice",
        header: "Fecha Emision",
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.date_invoice
              ? formatDate(row.original.date_invoice)
              : "-"}
          </span>
        ),
      },
      {
        accessorKey: "date_due",
        header: "Vencimiento",
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.date_due ? formatDate(row.original.date_due) : "-"}
          </span>
        ),
      },
      {
        id: "dias_vencido",
        header: "Dias Vencido",
        cell: ({ row }) => {
          const days = daysOverdue(row.original.date_due);
          return (
            <Badge
              variant="destructive"
              className="font-mono"
            >
              {days} dias
            </Badge>
          );
        },
      },
      {
        id: "estado",
        header: "Estado",
        cell: ({ row }) => {
          const status = row.original.payment_state || row.original.status || "overdue";
          return <StatusBadge status={status} />;
        },
      },
      {
        id: "acciones",
        header: "Acciones",
        enableSorting: false,
        cell: ({ row }) => <ActionsCell invoice={row.original} />,
      },
    ],
    [ActionsCell]
  );

  // Aging grouped columns
  const agingTableColumns: ColumnDef<AgingBucket>[] = useMemo(
    () => [
      {
        accessorKey: "bucket",
        header: "Periodo",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.bucket}</span>
        ),
      },
      {
        accessorKey: "count",
        header: "Facturas",
        cell: ({ row }) => <span>{row.original.count}</span>,
      },
      {
        accessorKey: "total",
        header: "Total",
        cell: ({ row }) => (
          <span className="font-mono font-semibold">
            {formatMoney(row.original.total)}
          </span>
        ),
      },
    ],
    []
  );

  const _isLoading =
    pendingQuery.isLoading || overdueQuery.isLoading || agingQuery.isLoading;

  // Aging KPI data
  const agingKpis = useMemo(() => {
    const icons = [Clock, Timer, AlertTriangle, AlertTriangle] as const;
    const colors = [
      "border-green-200 dark:border-green-900",
      "border-yellow-200 dark:border-yellow-900",
      "border-orange-200 dark:border-orange-900",
      "border-red-200 dark:border-red-900",
    ];
    return agingBuckets.map((b, i) => ({
      ...b,
      icon: icons[i] ?? AlertTriangle,
      className: colors[i] ?? "",
      destructive: i >= 3,
    }));
  }, [agingBuckets]);

  // Aging bar chart (simple CSS bars)
  const maxAgingTotal = useMemo(
    () => Math.max(...agingBuckets.map((b) => b.total), 1),
    [agingBuckets]
  );

  const toolbar = (
    <div className="flex items-center gap-4">
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Buscar por cliente, RFC o factura..."
        className="w-full max-w-sm"
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cobranza</h1>
          <p className="text-muted-foreground text-sm">
            Gestiona la cobranza de facturas y cuentas por cobrar.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PermissionGate permission="payments:create">
            <Button
              variant="outline"
              onClick={() => {
                setSelectedInvoice(null);
                setLinkDialogOpen(true);
              }}
            >
              <Link2 className="mr-2 size-4" />
              Generar Link de Pago
            </Button>
          </PermissionGate>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="pendientes">
            <Clock className="mr-1.5 size-4" />
            Pendientes
            {pendingQuery.data && (
              <Badge variant="secondary" className="ml-1.5">
                {(pendingQuery.data as Invoice[]).length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="vencidas">
            <AlertTriangle className="mr-1.5 size-4" />
            Vencidas
            {overdueQuery.data && (
              <Badge variant="destructive" className="ml-1.5">
                {(overdueQuery.data as Invoice[]).length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="aging">
            <BarChart3 className="mr-1.5 size-4" />
            Aging
          </TabsTrigger>
        </TabsList>

        {/* Tab: Pendientes */}
        <TabsContent value="pendientes">
          <DataTable
            columns={pendingColumns}
            data={filteredPending}
            isLoading={pendingQuery.isLoading}
            toolbar={toolbar}
            emptyState={
              <EmptyState
                icon={Receipt}
                title="Sin facturas pendientes"
                description="No hay facturas pendientes de cobro en este momento."
              />
            }
          />
        </TabsContent>

        {/* Tab: Vencidas */}
        <TabsContent value="vencidas">
          <DataTable
            columns={overdueColumns}
            data={filteredOverdue}
            isLoading={overdueQuery.isLoading}
            toolbar={toolbar}
            emptyState={
              <EmptyState
                icon={Receipt}
                title="Sin facturas vencidas"
                description="No hay facturas vencidas. Tu cartera esta al dia."
              />
            }
          />
        </TabsContent>

        {/* Tab: Aging */}
        <TabsContent value="aging">
          <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {agingKpis.map((kpi) => (
                <KpiCard
                  key={kpi.bucket}
                  title={kpi.bucket}
                  value={formatMoney(kpi.total)}
                  icon={kpi.icon}
                  description={`${kpi.count} factura${kpi.count !== 1 ? "s" : ""}`}
                  destructive={kpi.destructive}
                  className={kpi.className}
                />
              ))}
            </div>

            {/* Simple bar chart */}
            <div className="rounded-md border p-4 space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground">
                Distribucion por antiguedad
              </h3>
              {agingBuckets.map((b, i) => {
                const pct = (b.total / maxAgingTotal) * 100;
                const barColors = [
                  "bg-green-500",
                  "bg-yellow-500",
                  "bg-orange-500",
                  "bg-red-500",
                ];
                return (
                  <div key={b.bucket} className="flex items-center gap-3">
                    <span className="w-24 text-sm text-muted-foreground shrink-0">
                      {b.bucket}
                    </span>
                    <div className="flex-1 h-6 bg-muted rounded overflow-hidden">
                      <div
                        className={`h-full ${barColors[i] ?? "bg-gray-500"} rounded transition-all`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-28 text-sm font-mono text-right shrink-0">
                      {formatMoney(b.total)}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Aging grouped DataTable */}
            <DataTable
              columns={agingTableColumns}
              data={agingBuckets}
              isLoading={agingQuery.isLoading}
              emptyState={
                <EmptyState
                  icon={BarChart3}
                  title="Sin datos de aging"
                  description="No hay datos de antiguedad de saldos disponibles."
                />
              }
            />
          </div>
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <PaymentLinkDialog
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
        invoice={selectedInvoice}
      />
      <ManualPaymentDialog
        open={manualPayDialogOpen}
        onOpenChange={setManualPayDialogOpen}
        invoice={selectedInvoice}
      />
    </div>
  );
}
