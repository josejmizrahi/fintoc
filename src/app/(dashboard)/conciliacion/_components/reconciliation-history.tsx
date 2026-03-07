"use client";

import { useMemo } from "react";
import { type ColumnDef } from "@tanstack/react-table";

import { useReconciliationHistory } from "@/lib/hooks/use-reconciliation";
import { DataTable } from "@/components/shared/data-table";
import { formatDateTime } from "@/lib/utils/format";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

import type { ReconciliationRecord } from "./types";

export function ReconciliationHistory() {
  const { data: history, isLoading: historyLoading } = useReconciliationHistory();

  // History columns
  const historyColumns: ColumnDef<ReconciliationRecord, unknown>[] = useMemo(
    () => [
      { accessorKey: "id", header: "ID", cell: ({ row }) => (
        <span className="font-medium">#{row.original.id}</span>
      )},
      { accessorKey: "type", header: "Tipo", cell: ({ row }) => (
        <Badge variant="outline">{row.original.type ?? row.original.reconciliation_type ?? "-"}</Badge>
      )},
      { accessorKey: "period", header: "Periodo", cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.period ?? "-"}</span>
      )},
      { accessorKey: "matched", header: "Conciliados", cell: ({ row }) => (
        <span className="font-mono text-green-600">{row.original.matched ?? "-"}</span>
      )},
      { accessorKey: "unmatched", header: "No conciliados", cell: ({ row }) => (
        <span className="font-mono text-red-600">{row.original.unmatched ?? "-"}</span>
      )},
      { accessorKey: "created_at", header: "Fecha", cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.created_at ? formatDateTime(row.original.created_at) : "-"}
        </span>
      )},
    ],
    []
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Historial de Conciliaciones</CardTitle>
      </CardHeader>
      <CardContent>
        {historyLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-32" />
              </div>
            ))}
          </div>
        ) : (
          <DataTable
            columns={historyColumns}
            data={history ?? []}
            emptyState="No hay conciliaciones previas registradas."
          />
        )}
      </CardContent>
    </Card>
  );
}
