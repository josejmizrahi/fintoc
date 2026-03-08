"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Download, Play, Square } from "lucide-react";

import { api } from "@/lib/api";
import { formatDate } from "@/lib/utils/format";

import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";

import { Button } from "@/components/ui/button";

import { satKeys, extractionStatusBadge, EXTRACTOR_LABELS } from "./helpers";
import { NewExtractionDialog } from "./new-extraction-dialog";
import type { SyntageExtraction } from "./types";

export function ExtractionsTab({ taxpayerId }: { taxpayerId: string }) {
  const queryClient = useQueryClient();
  const [showNew, setShowNew] = useState(false);

  const extractionsQuery = useQuery({
    queryKey: satKeys.extractions(),
    queryFn: () => api.sat.syntage.extractions(),
    staleTime: 10_000,
    refetchInterval: (query) => {
      // Auto-refetch while any extraction is running
      const data = query.state.data as { extractions?: SyntageExtraction[] } | undefined;
      const hasRunning = data?.extractions?.some(
        (e: SyntageExtraction) => ["pending", "waiting", "running"].includes(e.status),
      );
      return hasRunning ? 5000 : false;
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: { extractor: string; options?: unknown }) =>
      api.sat.syntage.extract(taxpayerId, data.extractor, data.options as Record<string, unknown>),
    onSuccess: () => {
      toast.success("Extraction creada exitosamente");
      queryClient.invalidateQueries({ queryKey: satKeys.extractions() });
      setShowNew(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const stopMutation = useMutation({
    mutationFn: (id: string) => api.sat.syntage.stopExtraction(id),
    onSuccess: () => {
      toast.success("Extraction detenida");
      queryClient.invalidateQueries({ queryKey: satKeys.extractions() });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const extractions: SyntageExtraction[] = extractionsQuery.data?.extractions || [];

  const columns: ColumnDef<SyntageExtraction>[] = [
    {
      accessorKey: "id",
      header: "ID",
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.id.substring(0, 8)}...</span>,
    },
    {
      accessorKey: "extractor",
      header: "Tipo",
      cell: ({ row }) => (
        <span className="text-sm">{EXTRACTOR_LABELS[row.original.extractor] || row.original.extractor}</span>
      ),
    },
    {
      accessorKey: "status",
      header: "Estado",
      cell: ({ row }) => extractionStatusBadge(row.original.status),
    },
    {
      accessorKey: "createdAt",
      header: "Creada",
      cell: ({ row }) => <span className="text-sm">{formatDate(row.original.createdAt)}</span>,
    },
    {
      accessorKey: "updatedAt",
      header: "Actualizada",
      cell: ({ row }) => <span className="text-sm">{formatDate(row.original.updatedAt)}</span>,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const isRunning = ["pending", "waiting", "running"].includes(row.original.status);
        return isRunning ? (
          <Button variant="ghost" size="sm" onClick={() => stopMutation.mutate(row.original.id)}>
            <Square className="h-4 w-4 text-red-500" />
          </Button>
        ) : null;
      },
    },
  ];

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Jobs de descarga de datos del SAT via Syntage
        </p>
        <Button onClick={() => setShowNew(true)}>
          <Play className="h-4 w-4 mr-2" /> Nueva Extraction
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={extractions}
        isLoading={extractionsQuery.isLoading}
        emptyState={
          <EmptyState
            icon={Download}
            title="No hay extractions"
            description="Crea una extraction para descargar datos del SAT."
            action={{ label: "Nueva Extraction", onClick: () => setShowNew(true) }}
          />
        }
      />

      <NewExtractionDialog
        open={showNew}
        onClose={() => setShowNew(false)}
        taxpayerId={taxpayerId}
        onSubmit={(extractor, options) => createMutation.mutate({ extractor, options })}
        isLoading={createMutation.isPending}
      />
    </>
  );
}
