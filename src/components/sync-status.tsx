"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface DiffCounts {
  new: number;
  updated: number;
  unchanged: number;
}

interface SyncDiff {
  [entity: string]: DiffCounts;
}

interface SyncLog {
  id: number;
  provider: string;
  sync_type: string;
  status: "running" | "success" | "partial" | "error";
  total_items: number;
  processed_items: number;
  details: Record<string, unknown>;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

interface SyncStatusProps {
  provider: "odoo" | "fintoc" | "sat";
  syncLogId?: number;
  isRunning?: boolean;
}

function authHeaders() {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const diffMs = end - start;

  if (diffMs < 1000) return `${diffMs}ms`;
  if (diffMs < 60000) return `${(diffMs / 1000).toFixed(1)}s`;
  const minutes = Math.floor(diffMs / 60000);
  const seconds = Math.floor((diffMs % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function statusBadge(status: string) {
  switch (status) {
    case "running":
      return <Badge variant="secondary" className="animate-pulse">Sincronizando...</Badge>;
    case "success":
      return <Badge variant="default" className="bg-green-600 hover:bg-green-700 text-white">Completado</Badge>;
    case "partial":
      return <Badge variant="secondary" className="bg-yellow-500 hover:bg-yellow-600 text-white">Parcial</Badge>;
    case "error":
      return <Badge variant="destructive">Error</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function phaseBadge(phase: string) {
  switch (phase) {
    case "fetching":
      return <Badge variant="outline" className="text-blue-600 border-blue-300">Descargando datos...</Badge>;
    case "reviewing":
      return <Badge variant="outline" className="text-amber-600 border-amber-300">Revisando cambios...</Badge>;
    case "merging":
      return <Badge variant="outline" className="text-purple-600 border-purple-300">Aplicando cambios...</Badge>;
    case "done":
      return null;
    default:
      return null;
  }
}

const ENTITY_LABELS: Record<string, string> = {
  customers: "Clientes",
  vendors: "Proveedores",
  invoices: "Facturas",
  payments: "Pagos",
  expenses: "Gastos",
  purchase_orders: "Ordenes de compra",
  bank_movements: "Mov. bancarios",
  movements: "Movimientos",
};

function detailsLabel(key: string): string {
  const labels: Record<string, string> = {
    ...ENTITY_LABELS,
    updated: "Actualizadas",
    accounts: "Cuentas",
    new_payments: "Pagos nuevos",
    validated: "Validados",
    vigentes: "Vigentes",
    cancelados: "Cancelados",
    total_cfdis: "CFDIs totales",
    total_extracted: "Extraidos de SAT",
    new_invoices: "Facturas nuevas",
    errors: "Errores",
    phase: "Fase",
    total_fetched: "Total obtenidos",
    total_remote: "Total remoto",
  };
  return labels[key] || key;
}

/** Renders the diff summary as a visual changeset */
function DiffSummary({ diff }: { diff: SyncDiff }) {
  const entries = Object.entries(diff).filter(
    ([, counts]) => counts.new > 0 || counts.updated > 0,
  );

  if (entries.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic py-1">
        Sin cambios detectados
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {entries.map(([entity, counts]) => (
        <div key={entity} className="flex items-center justify-between text-xs">
          <span className="font-medium">{ENTITY_LABELS[entity] || entity}</span>
          <span className="flex items-center gap-2">
            {counts.new > 0 && (
              <span className="text-green-600 font-medium">+{counts.new} nuevos</span>
            )}
            {counts.updated > 0 && (
              <span className="text-amber-600 font-medium">~{counts.updated} actualizados</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

export function SyncStatus({ provider, syncLogId, isRunning }: SyncStatusProps) {
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [activeLog, setActiveLog] = useState<SyncLog | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch(`/api/sync-logs?provider=${provider}&limit=5`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      setLogs(data.logs || []);

      if (syncLogId && data.logs) {
        const found = data.logs.find((l: SyncLog) => l.id === syncLogId);
        if (found) setActiveLog(found);
      } else if (data.logs?.length > 0) {
        setActiveLog(data.logs[0]);
      }
    } catch {
      // Silently fail
    }
  }, [provider, syncLogId]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Poll while running with exponential backoff
  const pollCountRef = useRef(0);
  useEffect(() => {
    if (!isRunning && activeLog?.status !== "running") {
      pollCountRef.current = 0;
      return;
    }
    const getInterval = () => {
      const count = pollCountRef.current;
      if (count < 10) return 3000;    // First 10 polls: 3s (faster for diff phase)
      if (count < 20) return 10000;   // Next 10: 10s
      return 30000;                    // After 20: 30s
    };
    let timer: ReturnType<typeof setTimeout>;
    const poll = () => {
      fetchLogs();
      pollCountRef.current++;
      timer = setTimeout(poll, getInterval());
    };
    timer = setTimeout(poll, getInterval());
    return () => clearTimeout(timer);
  }, [isRunning, activeLog?.status, fetchLogs]);

  if (!activeLog && logs.length === 0) return null;

  const log = activeLog || logs[0];
  if (!log) return null;

  const progress = log.total_items > 0
    ? Math.round((log.processed_items / log.total_items) * 100)
    : log.status === "running" ? undefined : 100;

  const details = (log.details || {}) as Record<string, unknown>;
  const phase = details.phase as string | undefined;
  const diff = details.diff as SyncDiff | undefined;
  const summary = details.summary as string | undefined;

  // Filter detail entries for non-diff display
  const detailEntries = Object.entries(details).filter(
    ([key]) => !["phase", "total_fetched", "diff", "summary", "total_remote"].includes(key),
  );

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            Estado de sincronizacion
            {statusBadge(log.status)}
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            {formatDuration(log.started_at, log.completed_at)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Phase indicator */}
        {log.status === "running" && phase && (
          <div className="flex items-center gap-2">
            {phaseBadge(phase)}
            {details.total_remote != null && (
              <span className="text-xs text-muted-foreground">
                {String(details.total_remote)} registros remotos
              </span>
            )}
          </div>
        )}

        {/* Diff summary — shown during reviewing/merging/done phases */}
        {diff && (phase === "reviewing" || phase === "merging" || phase === "done") && (
          <div className="rounded-md border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">
                {phase === "done" ? "Cambios aplicados" : "Cambios detectados"}
              </span>
              {phase === "merging" && (
                <span className="text-xs text-purple-600 animate-pulse">Aplicando...</span>
              )}
            </div>
            <DiffSummary diff={diff} />
            {summary && phase === "done" && (
              <div className="text-xs text-muted-foreground pt-1 border-t">
                {summary}
              </div>
            )}
          </div>
        )}

        {/* Progress bar — for fetching phase */}
        {log.status === "running" && phase === "fetching" && (
          <div className="space-y-1.5">
            <Progress value={undefined} className="h-2" />
            <div className="text-xs text-muted-foreground">
              Descargando datos del proveedor...
            </div>
          </div>
        )}

        {/* Progress bar — for merging phase */}
        {log.status === "running" && phase === "merging" && (
          <div className="space-y-1.5">
            <Progress value={progress} className="h-2" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{log.processed_items} procesados</span>
              {log.total_items > 0 && <span>de {log.total_items}</span>}
            </div>
          </div>
        )}

        {/* Legacy progress for backward compat */}
        {log.status === "running" && !phase && (
          <div className="space-y-1.5">
            <Progress value={progress} className="h-2" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{log.processed_items} procesados</span>
              {log.total_items > 0 && <span>de {log.total_items}</span>}
            </div>
          </div>
        )}

        {/* Completed stats — only when no diff available */}
        {log.status !== "running" && !diff && detailEntries.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {detailEntries.map(([key, val]) => (
              <div key={key} className="text-xs">
                <span className="text-muted-foreground">{detailsLabel(key)}: </span>
                <span className="font-medium">{String(val)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Error message */}
        {log.error_message && (
          <p className="text-xs text-destructive">{log.error_message}</p>
        )}

        {/* Timestamps */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Inicio: {new Date(log.started_at).toLocaleString("es-MX")}</span>
          {log.completed_at && (
            <span>Fin: {new Date(log.completed_at).toLocaleString("es-MX")}</span>
          )}
        </div>

        {/* History */}
        {logs.length > 1 && (
          <div className="pt-2 border-t">
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Historial reciente</p>
            <div className="space-y-1">
              {logs.slice(0, 5).map((l) => (
                <button
                  key={l.id}
                  onClick={() => setActiveLog(l)}
                  className={`w-full text-left flex items-center justify-between px-2 py-1 rounded text-xs hover:bg-muted/50 transition-colors ${
                    l.id === log.id ? "bg-muted" : ""
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {statusBadge(l.status)}
                    <span className="text-muted-foreground">
                      {l.processed_items} registros
                    </span>
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(l.started_at).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
