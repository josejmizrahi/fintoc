"use client";

import { useState, useMemo, useEffect } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { type z } from "zod";
import { toast } from "sonner";
import {
  Users,
  Plus,
  Link2,
  Mail,
  FileText,
  BarChart3,
  Loader2,
  CheckCircle2,
  XCircle,
  Landmark,
} from "lucide-react";

import { api } from "@/lib/api";
import {
  useCustomers,
  useCreateCustomer,
  useCreateCustomerClabe,
} from "@/lib/hooks/use-customers";
import { useCustomerFilters } from "@/lib/hooks/use-url-state";
import { formatMoney, formatDate, formatCLABE, formatRFC } from "@/lib/utils/format";
import { createCustomerSchema } from "@/lib/utils/validation";
import type { Customer, Invoice } from "@/types";

import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { SearchInput } from "@/components/shared/search-input";
import { DetailPanel } from "@/components/shared/detail-panel";
import { PermissionGate } from "@/components/shared/permission-gate";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

/* ---------- Types ---------- */

type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

/* ---------- Aging helpers ---------- */

function daysOverdue(dateStr?: string): number {
  if (!dateStr) return 0;
  const due = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor(
    (now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)
  );
  return diff > 0 ? diff : 0;
}

/* ---------- Create Customer Dialog ---------- */

function CreateCustomerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createCustomer = useCreateCustomer();

  const form = useForm<CreateCustomerInput>({
    resolver: zodResolver(createCustomerSchema),
    defaultValues: {
      name: "",
      rfc: "",
      email: "",
      phone: "",
    },
  });

  function onSubmit(data: CreateCustomerInput) {
    createCustomer.mutate(data, {
      onSuccess: () => {
        form.reset();
        onOpenChange(false);
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo Cliente</DialogTitle>
          <DialogDescription>
            Ingresa los datos del cliente. Los campos con * son obligatorios.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 py-2">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre *</FormLabel>
                  <FormControl>
                    <Input placeholder="Nombre del cliente" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="rfc"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>RFC</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="XAXX010101000"
                      maxLength={13}
                      className="font-mono uppercase"
                      {...field}
                      onChange={(e) =>
                        field.onChange(e.target.value.toUpperCase())
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="cliente@empresa.com"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Telefono</FormLabel>
                  <FormControl>
                    <Input placeholder="+52 55 1234 5678" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={createCustomer.isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={createCustomer.isPending}>
                {createCustomer.isPending && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                Crear
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Customer Detail Content ---------- */

function CustomerDetailContent({ customerId }: { customerId: string }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.customers
      .invoices(customerId)
      .then(setInvoices)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [customerId]);

  // Compute aging from invoices
  const aging = useMemo(() => {
    const buckets = { "0-30d": 0, "31-60d": 0, "61-90d": 0, "90+d": 0 };
    invoices.forEach((inv) => {
      if ((inv.amount_residual ?? 0) <= 0) return;
      const days = daysOverdue(inv.date_due);
      if (days <= 30) buckets["0-30d"] += inv.amount_residual ?? 0;
      else if (days <= 60) buckets["31-60d"] += inv.amount_residual ?? 0;
      else if (days <= 90) buckets["61-90d"] += inv.amount_residual ?? 0;
      else buckets["90+d"] += inv.amount_residual ?? 0;
    });
    return buckets;
  }, [invoices]);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-4">
      {invoices.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          Sin facturas registradas.
        </p>
      ) : (
        <div className="space-y-2">
          {invoices.map((inv) => (
            <div
              key={inv.id}
              className="flex items-center justify-between rounded-md border p-3 text-sm"
            >
              <div>
                <p className="font-medium">{inv.name}</p>
                <p className="text-xs text-muted-foreground">
                  Vence: {inv.date_due ? formatDate(inv.date_due) : "-"}
                </p>
                {inv.payment_state && (
                  <StatusBadge status={inv.payment_state} />
                )}
              </div>
              <div className="text-right">
                <p className="font-mono font-semibold">
                  {formatMoney(inv.amount_residual ?? 0)}
                </p>
                <p className="text-xs text-muted-foreground font-mono">
                  de {formatMoney(inv.amount_total ?? 0)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CustomerAgingContent({ customerId }: { customerId: string }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.customers
      .invoices(customerId)
      .then(setInvoices)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [customerId]);

  const aging = useMemo(() => {
    const buckets: Record<string, number> = {
      "0-30 dias": 0,
      "31-60 dias": 0,
      "61-90 dias": 0,
      "90+ dias": 0,
    };
    invoices.forEach((inv) => {
      if ((inv.amount_residual ?? 0) <= 0) return;
      const days = daysOverdue(inv.date_due);
      if (days <= 30) buckets["0-30 dias"] += inv.amount_residual ?? 0;
      else if (days <= 60) buckets["31-60 dias"] += inv.amount_residual ?? 0;
      else if (days <= 90) buckets["61-90 dias"] += inv.amount_residual ?? 0;
      else buckets["90+ dias"] += inv.amount_residual ?? 0;
    });
    return buckets;
  }, [invoices]);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3 pt-4">
      {Object.entries(aging).map(([bucket, total]) => (
        <div
          key={bucket}
          className="flex items-center justify-between rounded-md border p-3 text-sm"
        >
          <span className="text-muted-foreground">{bucket}</span>
          <span className="font-mono font-semibold">{formatMoney(total)}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- Main Page ---------- */

export default function ClientesPage() {
  const [filters, setFilters] = useCustomerFilters();
  const [createOpen, setCreateOpen] = useState(false);
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);

  // TanStack Query hooks
  const { data: customersRaw, isLoading } = useCustomers({
    search: filters.search,
    page: filters.page,
    per_page: filters.per_page,
  });
  const customers = (customersRaw ?? []) as Customer[];

  const createClabe = useCreateCustomerClabe();

  // Actions
  function handleAssignClabe(customer: Customer) {
    createClabe.mutate(customer.id);
  }

  function handlePaymentLink(customer: Customer) {
    toast.info("Generando link de pago para " + customer.name);
  }

  async function handleSendStatement(customer: Customer) {
    try {
      await api.collections.sendReminder({ customer_id: customer.id, type: "statement" });
      toast.success("Estado de cuenta enviado a " + customer.name);
    } catch (err: any) {
      toast.error(err.message || "Error al enviar estado de cuenta");
    }
  }

  // Columns
  const columns: ColumnDef<Customer>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Nombre",
        cell: ({ row }) => (
          <button
            className="text-left font-medium text-primary hover:underline cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              setDetailCustomer(row.original);
            }}
          >
            {row.original.name || "-"}
          </button>
        ),
      },
      {
        accessorKey: "rfc",
        header: "RFC",
        cell: ({ row }) => (
          <span className="font-mono text-sm">
            {row.original.rfc ? formatRFC(row.original.rfc) : "-"}
          </span>
        ),
      },
      {
        accessorKey: "email",
        header: "Email",
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {row.original.email || "-"}
          </span>
        ),
      },
      {
        id: "fintoc_clabe",
        header: "CLABE Dedicada (Fintoc)",
        cell: ({ row }) =>
          row.original.fintoc_clabe ? (
            <span className="font-mono text-xs">
              {formatCLABE(row.original.fintoc_clabe)}
            </span>
          ) : row.original.fintoc_account_number_id ? (
            <Badge
              variant="outline"
              className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
            >
              <Landmark className="mr-1 size-3" />
              Asignada
            </Badge>
          ) : (
            <span className="text-muted-foreground text-sm">Sin asignar</span>
          ),
      },
      {
        accessorKey: "clabe",
        header: "CLABE Cliente",
        cell: ({ row }) =>
          row.original.clabe ? (
            <span className="font-mono text-xs">
              {formatCLABE(row.original.clabe)}
            </span>
          ) : (
            <span className="text-muted-foreground text-sm">-</span>
          ),
      },
      {
        id: "rfc_valid",
        header: "RFC Valido?",
        cell: ({ row }) =>
          row.original.rfc_validated ? (
            <Badge
              variant="outline"
              className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
            >
              <CheckCircle2 className="mr-1 size-3" />
              Si
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              Pendiente
            </Badge>
          ),
      },
      {
        id: "acciones",
        header: "Acciones",
        enableSorting: false,
        cell: ({ row }) => {
          const customer = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  Acciones
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <PermissionGate permission="customers:write">
                  <DropdownMenuItem
                    onClick={() => handleAssignClabe(customer)}
                    disabled={
                      !!customer.fintoc_account_number_id ||
                      createClabe.isPending
                    }
                  >
                    <Landmark className="mr-2 size-4" />
                    Asignar CLABE Dedicada
                  </DropdownMenuItem>
                </PermissionGate>
                <DropdownMenuItem onClick={() => handlePaymentLink(customer)}>
                  <Link2 className="mr-2 size-4" />
                  Generar Link de Pago
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleSendStatement(customer)}
                >
                  <Mail className="mr-2 size-4" />
                  Enviar Estado de Cuenta
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setDetailCustomer(customer)}
                >
                  <BarChart3 className="mr-2 size-4" />
                  Ver Cobranza
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [createClabe.isPending]
  );

  const toolbar = (
    <div className="flex items-center justify-between gap-4">
      <SearchInput
        value={filters.search}
        onChange={(value) => setFilters({ search: value, page: 1 })}
        placeholder="Buscar por nombre, RFC o email..."
        className="w-full max-w-sm"
      />
      <PermissionGate permission="customers:write">
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 size-4" />
          Nuevo Cliente
        </Button>
      </PermissionGate>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Clientes</h1>
        <p className="text-muted-foreground text-sm">
          Gestiona clientes, CLABEs dedicadas y cobranza.
        </p>
      </div>

      {/* DataTable */}
      <DataTable
        columns={columns}
        data={customers}
        isLoading={isLoading}
        toolbar={toolbar}
        onRowClick={(customer) => setDetailCustomer(customer)}
        emptyState={
          <EmptyState
            icon={Users}
            title="Sin clientes"
            description="No hay clientes registrados. Crea uno nuevo o sincroniza desde Odoo."
            action={{
              label: "Nuevo Cliente",
              onClick: () => setCreateOpen(true),
            }}
          />
        }
      />

      {/* Detail Panel */}
      <DetailPanel
        isOpen={!!detailCustomer}
        onClose={() => setDetailCustomer(null)}
        title={detailCustomer?.name || "Detalle del Cliente"}
        tabs={["Informacion", "Facturas", "Pagos Recibidos", "Aging"]}
      >
        {/* Tab: Informacion */}
        <div className="space-y-4 pt-4">
          {detailCustomer && (
            <div className="grid grid-cols-[120px_1fr] gap-y-3 text-sm">
              <span className="font-medium text-muted-foreground">Nombre</span>
              <span>{detailCustomer.name}</span>

              <span className="font-medium text-muted-foreground">RFC</span>
              <span className="font-mono">
                {detailCustomer.rfc ? formatRFC(detailCustomer.rfc) : "-"}
              </span>

              <span className="font-medium text-muted-foreground">Email</span>
              <span>{detailCustomer.email || "-"}</span>

              <span className="font-medium text-muted-foreground">
                Telefono
              </span>
              <span>{detailCustomer.phone || "-"}</span>

              <span className="font-medium text-muted-foreground">
                CLABE Cliente
              </span>
              <span className="font-mono">{detailCustomer.clabe || "-"}</span>

              <span className="font-medium text-muted-foreground">
                CLABE Fintoc
              </span>
              <span className="font-mono">
                {detailCustomer.fintoc_clabe || "-"}
              </span>

              <span className="font-medium text-muted-foreground">
                RFC Validado
              </span>
              <span>
                {detailCustomer.rfc_validated ? (
                  <Badge
                    variant="outline"
                    className="bg-green-100 text-green-800"
                  >
                    Si
                  </Badge>
                ) : (
                  "No"
                )}
              </span>

              <span className="font-medium text-muted-foreground">
                Regimen Fiscal
              </span>
              <span>{detailCustomer.regimen_fiscal || "-"}</span>
            </div>
          )}
        </div>

        {/* Tab: Facturas */}
        <div>
          {detailCustomer && (
            <CustomerDetailContent customerId={detailCustomer.id} />
          )}
        </div>

        {/* Tab: Pagos Recibidos */}
        <div className="pt-4">
          <p className="text-sm text-muted-foreground text-center py-4">
            Los pagos recibidos se muestran en la seccion de tesoreria.
          </p>
        </div>

        {/* Tab: Aging */}
        <div>
          {detailCustomer && (
            <CustomerAgingContent customerId={detailCustomer.id} />
          )}
        </div>
      </DetailPanel>

      {/* Create Dialog */}
      <CreateCustomerDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
