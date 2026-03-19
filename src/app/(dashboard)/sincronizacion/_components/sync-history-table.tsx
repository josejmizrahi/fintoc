"use client";

import { useQuery } from "@tanstack/react-query";
import { ColumnDef } from "@tanstack/react-table";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Clock,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DataTable } from "@/components/shared/data-table";
import { api } from "@/lib/api";
import { formatRelative } from "@/lib/utils/format";

interface SyncHistoryEntry {
  provider: string;
  status: string;
  records_synced: number;
  completed_at: string;
  error_message?: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  odoo: "Odoo",
  fintoc: "Fintoc",
  syntage: "SAT/Syntage",
  sat: "SAT/Syntage",
};

const STATUS_ICONS: Record<string, { icon: typeof CheckCircle2; className: string; label: string }> = {
  completed: { icon: CheckCircle2, className: "text-green-600", label: "Completado" },
  partial: { icon: AlertTriangle, className: "text-yellow-600", label: "Parcial" },
  failed: { icon: XCircle, className: "text-destructive", label: "Error" },
  running: { icon: Loader2, className: "text-blue-600 animate-spin", label: "En proceso" },
};

const columns: ColumnDef<SyncHistoryEntry>[] = [
  {
    accessorKey: "provider",
    header: "Proveedor",
    cell: ({ row }) => (
      <span className="font-medium">
        {PROVIDER_LABELS[row.original.provider] || row.original.provider}
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: "Estado",
    cell: ({ row }) => {
      const status = row.original.status;
      const info = STATUS_ICONS[status] || STATUS_ICONS.failed;
      const Icon = info.icon;
      return (
        <div className="flex items-center gap-1.5">
          <Icon className={`size-3.5 ${info.className}`} />
          <Badge
            variant={status === "completed" ? "default" : status === "failed" ? "destructive" : "outline"}
            className="text-xs"
          >
            {info.label}
          </Badge>
        </div>
      );
    },
  },
  {
    accessorKey: "records_synced",
    header: "Registros",
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.records_synced ?? 0}</span>
    ),
  },
  {
    accessorKey: "completed_at",
    header: "Fecha",
    cell: ({ row }) => (
      <div className="flex items-center gap-1 text-muted-foreground">
        <Clock className="size-3" />
        {row.original.completed_at
          ? formatRelative(row.original.completed_at)
          : "—"}
      </div>
    ),
  },
  {
    accessorKey: "error_message",
    header: "Errores",
    cell: ({ row }) => {
      const msg = row.original.error_message;
      if (!msg) return <span className="text-muted-foreground">—</span>;
      return (
        <span className="text-xs text-destructive line-clamp-2" title={msg}>
          {msg}
        </span>
      );
    },
  },
];

export function SyncHistoryTable() {
  const { data, isLoading } = useQuery({
    queryKey: ["sync", "status"],
    queryFn: () => api.sync.status(),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const syncs = (data?.data?.recentSyncs || []) as SyncHistoryEntry[];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Historial de sincronizacion</CardTitle>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns}
          data={syncs}
          isLoading={isLoading}
          emptyState={
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
              <Clock className="size-8" />
              <p className="text-sm">No hay sincronizaciones recientes</p>
            </div>
          }
        />
      </CardContent>
    </Card>
  );
}
