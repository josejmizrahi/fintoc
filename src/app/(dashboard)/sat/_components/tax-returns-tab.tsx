"use client";

import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { Calendar } from "lucide-react";

import { formatDate } from "@/lib/utils/format";
import { api } from "@/lib/api";

import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";

import { Badge } from "@/components/ui/badge";

import { satKeys } from "./helpers";

export function TaxReturnsTab({ taxpayerId }: { taxpayerId: string }) {
  const taxReturnsQuery = useQuery({
    queryKey: satKeys.taxReturns(taxpayerId),
    queryFn: () => api.sat.syntage.taxReturns(taxpayerId),
    enabled: !!taxpayerId,
    staleTime: 60_000,
  });

  const taxReturns = (taxReturnsQuery.data?.taxReturns || []) as Array<Record<string, unknown>>;

  const columns: ColumnDef<Record<string, unknown>>[] = [
    {
      accessorKey: "operationNumber",
      header: "No. Operacion",
      cell: ({ row }) => <span className="font-mono text-xs">{String(row.original.operationNumber || "-")}</span>,
    },
    {
      accessorKey: "type",
      header: "Tipo",
      cell: ({ row }) => {
        const type = String(row.original.type || "");
        const labels: Record<string, string> = {
          annual: "Anual",
          monthly: "Mensual",
          rif: "RIF",
        };
        return <Badge variant="outline">{labels[type] || type}</Badge>;
      },
    },
    {
      accessorKey: "period",
      header: "Periodo",
      cell: ({ row }) => <span className="text-sm">{String(row.original.period || "-")}</span>,
    },
    {
      accessorKey: "year",
      header: "Anio",
      cell: ({ row }) => <span className="text-sm">{String(row.original.year || "-")}</span>,
    },
    {
      accessorKey: "normalOrComplementary",
      header: "Tipo Declaracion",
      cell: ({ row }) => {
        const val = String(row.original.normalOrComplementary || "");
        return val === "complementary" ? (
          <Badge variant="outline" className="bg-yellow-100 text-yellow-800">Complementaria</Badge>
        ) : (
          <Badge variant="outline" className="bg-blue-100 text-blue-800">Normal</Badge>
        );
      },
    },
    {
      accessorKey: "createdAt",
      header: "Fecha",
      cell: ({ row }) => (
        <span className="text-sm">{row.original.createdAt ? formatDate(String(row.original.createdAt)) : "-"}</span>
      ),
    },
  ];

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Declaraciones fiscales del contribuyente (anuales, mensuales, provisionales)
      </p>
      <DataTable
        columns={columns}
        data={taxReturns}
        isLoading={taxReturnsQuery.isLoading}
        emptyState={
          <EmptyState
            icon={Calendar}
            title="No hay declaraciones"
            description="Las declaraciones apareceran aqui despues de una extraction de tipo 'Declaracion'."
          />
        }
      />
    </>
  );
}
