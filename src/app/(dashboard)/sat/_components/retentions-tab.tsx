"use client";

import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { ShieldAlert } from "lucide-react";

import { formatMoney, formatDate } from "@/lib/utils/format";
import { api } from "@/lib/api";

import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";

import { satKeys } from "./helpers";

export function RetentionsTab({ taxpayerId }: { taxpayerId: string }) {
  const retentionsQuery = useQuery({
    queryKey: satKeys.taxRetentions(taxpayerId),
    queryFn: () => api.sat.syntage.taxRetentions(taxpayerId),
    enabled: !!taxpayerId,
    staleTime: 60_000,
  });

  const retentions = (retentionsQuery.data?.retentions || []) as Array<Record<string, unknown>>;

  const columns: ColumnDef<Record<string, unknown>>[] = [
    {
      accessorKey: "uuid",
      header: "UUID",
      cell: ({ row }) => (
        <span className="font-mono text-xs">{String(row.original.uuid || "").substring(0, 8)}...</span>
      ),
    },
    {
      id: "emisor",
      header: "Emisor",
      cell: ({ row }) => {
        const issuer = row.original.issuer as Record<string, string> | undefined;
        return (
          <div>
            <p className="text-sm">{issuer?.name || "-"}</p>
            <p className="text-xs text-muted-foreground">{issuer?.rfc || ""}</p>
          </div>
        );
      },
    },
    {
      id: "receptor",
      header: "Receptor",
      cell: ({ row }) => {
        const receiver = row.original.receiver as Record<string, string> | undefined;
        return (
          <div>
            <p className="text-sm">{receiver?.name || "-"}</p>
            <p className="text-xs text-muted-foreground">{receiver?.rfc || ""}</p>
          </div>
        );
      },
    },
    {
      accessorKey: "total",
      header: "Monto",
      cell: ({ row }) => (
        <span className="font-medium">{formatMoney(Number(row.original.total) || 0)}</span>
      ),
    },
    {
      accessorKey: "issuedAt",
      header: "Fecha",
      cell: ({ row }) => (
        <span className="text-sm">{row.original.issuedAt ? formatDate(String(row.original.issuedAt)) : "-"}</span>
      ),
    },
  ];

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Retenciones e informacion de pagos del contribuyente
      </p>
      <DataTable
        columns={columns}
        data={retentions}
        isLoading={retentionsQuery.isLoading}
        emptyState={
          <EmptyState
            icon={ShieldAlert}
            title="No hay retenciones"
            description="Las retenciones apareceran aqui despues de una extraction de tipo 'Retenciones'."
          />
        }
      />
    </>
  );
}
