"use client";

import { type ColumnDef } from "@tanstack/react-table";
import {
  MoreHorizontal,
  Play,
  Ban,
  RefreshCw,
  Eye,
} from "lucide-react";

import { Payment } from "@/types";
import { formatMoney, formatDate } from "@/lib/utils/format";

import { StatusBadge } from "@/components/shared/status-badge";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function getColumns(opts: {
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
