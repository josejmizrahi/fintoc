"use client";

import { useState, useMemo, useEffect } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { type z } from "zod";
import { toast } from "sonner";
import {
  Users,
  Plus,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  FileText,
  CreditCard,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
} from "lucide-react";

import { api } from "@/lib/api";
import {
  useVendors,
  useCreateVendor,
  useVerifyVendorClabe,
  vendorKeys,
} from "@/lib/hooks/use-vendors";
import { useVendorFilters } from "@/lib/hooks/use-url-state";
import { formatMoney, formatDate, formatCLABE, formatRFC } from "@/lib/utils/format";
import { createVendorSchema } from "@/lib/utils/validation";
import { getBankFromCLABE } from "@/lib/utils/constants";
import type { Vendor, Invoice } from "@/types";

import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { SearchInput } from "@/components/shared/search-input";
import { DetailPanel } from "@/components/shared/detail-panel";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { PermissionGate } from "@/components/shared/permission-gate";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

/* ---------- Types ---------- */

type CreateVendorInput = z.infer<typeof createVendorSchema>;

/* ---------- EFOS badge ---------- */

function EfosBadge({ status }: { status?: string }) {
  if (!status || status === "clean" || status === "200") {
    return (
      <Badge
        variant="outline"
        className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
      >
        <ShieldCheck className="mr-1 size-3" />
        Limpio
      </Badge>
    );
  }
  if (status === "presumed" || status === "201") {
    return (
      <Badge
        variant="outline"
        className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
      >
        <ShieldAlert className="mr-1 size-3" />
        Presunto
      </Badge>
    );
  }
  if (status === "definitive" || status === "definitivo" || status === "203") {
    return (
      <Badge variant="destructive">
        <ShieldX className="mr-1 size-3" />
        Definitivo
      </Badge>
    );
  }
  if (status === "disproved" || status === "202") {
    return (
      <Badge
        variant="outline"
        className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
      >
        Desvirtuado
      </Badge>
    );
  }
  if (status === "favorable" || status === "204") {
    return (
      <Badge
        variant="outline"
        className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
      >
        Favorable
      </Badge>
    );
  }
  return <Badge variant="outline">Sin verificar</Badge>;
}

/* ---------- Create Vendor Dialog ---------- */

function CreateVendorDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createVendor = useCreateVendor();

  const form = useForm<CreateVendorInput>({
    resolver: zodResolver(createVendorSchema),
    defaultValues: {
      name: "",
      rfc: "",
      email: "",
      phone: "",
      clabe: "",
    },
  });

  const clabeValue = form.watch("clabe");
  const detectedBank = clabeValue && clabeValue.length >= 3
    ? getBankFromCLABE(clabeValue)
    : "";

  function onSubmit(data: CreateVendorInput) {
    createVendor.mutate(data, {
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
          <DialogTitle>Nuevo Proveedor</DialogTitle>
          <DialogDescription>
            Ingresa los datos del proveedor. Los campos con * son obligatorios.
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
                    <Input placeholder="Nombre del proveedor" {...field} />
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
                      placeholder="proveedor@empresa.com"
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
            <FormField
              control={form.control}
              name="clabe"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>CLABE (18 digitos)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="000000000000000000"
                      maxLength={18}
                      className="font-mono tracking-wider"
                      {...field}
                      onChange={(e) =>
                        field.onChange(
                          e.target.value.replace(/\D/g, "").slice(0, 18)
                        )
                      }
                    />
                  </FormControl>
                  {detectedBank && (
                    <p className="text-xs text-muted-foreground">
                      Banco detectado: <strong>{detectedBank}</strong>
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={createVendor.isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={createVendor.isPending}>
                {createVendor.isPending && (
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

/* ---------- Vendor Detail Panel ---------- */

function VendorDetailContent({ vendorId }: { vendorId: string }) {
  const [bills, setBills] = useState<Invoice[]>([]);
  const [billsLoading, setBillsLoading] = useState(true);
  const [payments, setPayments] = useState<any[]>([]);

  useEffect(() => {
    setBillsLoading(true);
    api.vendors
      .bills(vendorId)
      .then(setBills)
      .catch(() => {})
      .finally(() => setBillsLoading(false));
  }, [vendorId]);

  return (
    <div className="space-y-6 pt-4">
      {/* Bills */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Facturas por Pagar ({bills.length})
        </h3>
        {billsLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : bills.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Sin facturas pendientes.
          </p>
        ) : (
          <div className="space-y-2">
            {bills.map((bill) => (
              <div
                key={bill.id}
                className="flex items-center justify-between rounded-md border p-3 text-sm"
              >
                <div>
                  <p className="font-medium">{bill.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Vence: {bill.date_due ? formatDate(bill.date_due) : "-"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono font-semibold">
                    {formatMoney(bill.amount_residual ?? 0)}
                  </p>
                  <p className="text-xs text-muted-foreground font-mono">
                    de {formatMoney(bill.amount_total ?? 0)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Main Page ---------- */

export default function ProveedoresPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useVendorFilters();
  const [createOpen, setCreateOpen] = useState(false);
  const [detailVendor, setDetailVendor] = useState<Vendor | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  // TanStack Query hooks
  const { data: vendorsRaw, isLoading } = useVendors({
    search: filters.search,
    page: filters.page,
    per_page: filters.per_page,
  });
  const vendors = (vendorsRaw ?? []) as Vendor[];

  const verifyClabe = useVerifyVendorClabe();

  // Actions
  function handleVerifyClabe(vendor: Vendor) {
    verifyClabe.mutate(vendor.id);
  }

  async function handleValidateRfc(vendor: Vendor) {
    if (!vendor.rfc) {
      toast.error("El proveedor no tiene RFC registrado");
      return;
    }
    try {
      const result = await api.sat.validateRfc({ rfc: vendor.rfc });
      if (result.valid) {
        toast.success(`RFC ${vendor.rfc} es valido`);
      } else {
        toast.error(`RFC ${vendor.rfc} es invalido`);
      }
    } catch (err: any) {
      toast.error(err.message || "Error al validar RFC");
    }
  }

  async function handleCheckEfos(vendor: Vendor) {
    if (!vendor.rfc) {
      toast.error("El proveedor no tiene RFC registrado");
      return;
    }
    try {
      const result = await api.sat.checkEfos({ rfc: vendor.rfc });
      toast.success(
        `EFOS verificado: ${result.efos_status || result.status || "limpio"}`
      );
    } catch (err: any) {
      toast.error(err.message || "Error al verificar EFOS");
    }
  }

  async function handleSyncOdoo(_vendor: Vendor) {
    setSyncingId("_all");
    try {
      const result = await api.sync.odooPartners();
      const d = (result as { data?: { vendors_synced?: number; customers_synced?: number } })?.data;
      const v = d?.vendors_synced ?? 0;
      toast.success(`Proveedores actualizados desde Odoo — ${v} registros`);
      queryClient.invalidateQueries({ queryKey: vendorKeys.all });
    } catch (err: any) {
      toast.error(err.message || "Error al sincronizar");
    } finally {
      setSyncingId(null);
    }
  }

  // Columns
  const columns: ColumnDef<Vendor>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Nombre",
        cell: ({ row }) => (
          <button
            className="text-left font-medium text-primary hover:underline cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              setDetailVendor(row.original);
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
        accessorKey: "clabe",
        header: "CLABE",
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
        id: "banco",
        header: "Banco",
        cell: ({ row }) => {
          const bank =
            row.original.bank_name ||
            (row.original.clabe ? getBankFromCLABE(row.original.clabe) : "");
          return (
            <span className="text-sm">{bank || "-"}</span>
          );
        },
      },
      {
        id: "clabe_verified",
        header: "CLABE Verificada?",
        cell: ({ row }) =>
          row.original.clabe_verified ? (
            <Badge
              variant="outline"
              className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
            >
              <CheckCircle2 className="mr-1 size-3" />
              Si
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              <XCircle className="mr-1 size-3" />
              No
            </Badge>
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
        id: "efos",
        header: "EFOS",
        cell: ({ row }) => <EfosBadge status={row.original.efos_status} />,
      },
      {
        id: "acciones",
        header: "Acciones",
        enableSorting: false,
        cell: ({ row }) => {
          const vendor = row.original;
          const isEfosBlocked =
            vendor.efos_status === "definitivo" ||
            vendor.efos_status === "definitive" ||
            vendor.efos_status === "203";
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  Acciones
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => handleVerifyClabe(vendor)}
                  disabled={!vendor.clabe || verifyClabe.isPending}
                >
                  <CheckCircle2 className="mr-2 size-4" />
                  Verificar CLABE
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleValidateRfc(vendor)}
                  disabled={!vendor.rfc}
                >
                  <FileText className="mr-2 size-4" />
                  Validar RFC
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleCheckEfos(vendor)}>
                  <ShieldAlert className="mr-2 size-4" />
                  Verificar EFOS
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <DropdownMenuItem
                          disabled={isEfosBlocked}
                          onClick={() => {
                            if (!isEfosBlocked) {
                              toast.info(
                                "Redirigiendo a crear pago para " + vendor.name
                              );
                            }
                          }}
                        >
                          <CreditCard className="mr-2 size-4" />
                          Crear Pago
                        </DropdownMenuItem>
                      </div>
                    </TooltipTrigger>
                    {isEfosBlocked && (
                      <TooltipContent>
                        <p>
                          Proveedor bloqueado por EFOS definitivo. No se
                          pueden crear pagos.
                        </p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => handleSyncOdoo(vendor)}
                  disabled={!!syncingId}
                >
                  <RefreshCw className="mr-2 size-4" />
                  Sync desde Odoo
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [verifyClabe.isPending, syncingId]
  );

  const toolbar = (
    <div className="flex items-center justify-between gap-4">
      <SearchInput
        value={filters.search}
        onChange={(value) => setFilters({ search: value, page: 1 })}
        placeholder="Buscar por nombre, RFC o email..."
        className="w-full max-w-sm"
      />
      <PermissionGate permission="vendors:write">
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 size-4" />
          Nuevo Proveedor
        </Button>
      </PermissionGate>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Proveedores</h1>
        <p className="text-muted-foreground text-sm">
          Gestiona proveedores, CLABEs y facturas por pagar.
        </p>
      </div>

      {/* DataTable */}
      <DataTable
        columns={columns}
        data={vendors}
        isLoading={isLoading}
        toolbar={toolbar}
        onRowClick={(vendor) => setDetailVendor(vendor)}
        emptyState={
          <EmptyState
            icon={Users}
            title="Sin proveedores"
            description="No hay proveedores registrados. Crea uno nuevo o sincroniza desde Odoo."
            action={{
              label: "Nuevo Proveedor",
              onClick: () => setCreateOpen(true),
            }}
          />
        }
      />

      {/* Detail Panel */}
      <DetailPanel
        isOpen={!!detailVendor}
        onClose={() => setDetailVendor(null)}
        title={detailVendor?.name || "Detalle del Proveedor"}
        tabs={["Informacion", "Facturas"]}
      >
        {/* Tab: Informacion */}
        <div className="space-y-4 pt-4">
          {detailVendor && (
            <>
              <div className="grid grid-cols-[120px_1fr] gap-y-3 text-sm">
                <span className="font-medium text-muted-foreground">
                  Nombre
                </span>
                <span>{detailVendor.name}</span>

                <span className="font-medium text-muted-foreground">RFC</span>
                <span className="font-mono">
                  {detailVendor.rfc ? formatRFC(detailVendor.rfc) : "-"}
                </span>

                <span className="font-medium text-muted-foreground">Email</span>
                <span>{detailVendor.email || "-"}</span>

                <span className="font-medium text-muted-foreground">
                  Telefono
                </span>
                <span>{detailVendor.phone || "-"}</span>

                <span className="font-medium text-muted-foreground">CLABE</span>
                <span className="font-mono">
                  {detailVendor.clabe || "-"}
                </span>

                <span className="font-medium text-muted-foreground">Banco</span>
                <span>
                  {detailVendor.bank_name ||
                    (detailVendor.clabe
                      ? getBankFromCLABE(detailVendor.clabe)
                      : "-")}
                </span>

                <span className="font-medium text-muted-foreground">
                  CLABE Verificada
                </span>
                <span>
                  {detailVendor.clabe_verified ? (
                    <Badge variant="outline" className="bg-green-100 text-green-800">
                      Si
                    </Badge>
                  ) : (
                    "No"
                  )}
                </span>

                <span className="font-medium text-muted-foreground">EFOS</span>
                <EfosBadge status={detailVendor.efos_status} />

                <span className="font-medium text-muted-foreground">
                  Regimen Fiscal
                </span>
                <span>{detailVendor.regimen_fiscal || "-"}</span>
              </div>
            </>
          )}
        </div>

        {/* Tab: Facturas */}
        <div>
          {detailVendor && <VendorDetailContent vendorId={detailVendor.id} />}
        </div>
      </DetailPanel>

      {/* Create Dialog */}
      <CreateVendorDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
