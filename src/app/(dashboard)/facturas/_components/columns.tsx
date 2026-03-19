"use client";

import { useMemo } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import {
  MoreHorizontal,
  ShieldCheck,
  Eye,
  CreditCard,
  Link2,
  Receipt,
  XCircle,
} from "lucide-react";

import { usePermission } from "@/lib/hooks/use-permission";
import { formatMoney, formatDate } from "@/lib/utils/format";
import type { Invoice } from "@/types";

import { StatusBadge } from "@/components/shared/status-badge";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

/* ---------- Helpers ---------- */

export function daysOverdue(dueDate?: string): number {
  if (!dueDate) return 0;
  const due = new Date(dueDate);
  const now = new Date();
  const diff = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 0;
}

export function truncateUuid(uuid?: string, chars = 8): string {
  if (!uuid) return "-";
  return uuid.slice(0, chars) + "...";
}

export function getSatSemaphoreColor(satStatus?: string, efosStatus?: string): "green" | "yellow" | "red" {
  const sat = satStatus?.toLowerCase();
  const efos = efosStatus?.toLowerCase();

  if (sat === "cancelado" || efos === "definitivo") return "red";
  if (sat === "vigente" && efos === "presunto") return "yellow";
  if (sat === "vigente") return "green";
  return "red";
}

export function SatSemaphore({ satStatus, efosStatus }: { satStatus?: string; efosStatus?: string }) {
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

/* ---------- Column Definitions ---------- */

export function useInvoiceColumns(
  tab: "payable" | "receivable",
  onAction: (action: string, invoice: Invoice) => void
): ColumnDef<Invoice, unknown>[] {
  const canValidate = usePermission("invoices.validate");
  const canCancelCfdi = usePermission("invoices.cancel");
  const canCreatePayment = usePermission("payments.create");

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
          const overdue = inv.due_date && daysOverdue(inv.due_date) > 0 && residual > 0;
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
        accessorKey: "invoice_date",
        header: "Fecha",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {row.original.invoice_date ? formatDate(row.original.invoice_date) : "-"}
          </span>
        ),
        size: 100,
      },
      {
        accessorKey: "due_date",
        header: "Vencimiento",
        cell: ({ row }) => {
          const inv = row.original;
          if (!inv.due_date) return <span className="text-sm text-muted-foreground">-</span>;
          const days = daysOverdue(inv.due_date);
          return (
            <div className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="text-sm">{formatDate(inv.due_date)}</span>
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
