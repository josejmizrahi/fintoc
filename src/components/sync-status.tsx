"use client";

import { useEffect, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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

function detailsLabel(key: string): string {
  const labels: Record<string, string> = {
    customers: "Clientes",
    vendors: "Proveedores",
    invoices: "Facturas",
    updated: "Actualizadas",
    payments: "Pagos",
    accounts: "Cuentas",
    movements: "Movimientos",
    new_payments: "Pagos nuevos",
    validated: "Validados",
    vigentes: "Vigentes",
    cancelados: "Cancelados",
    total_cfdis: "CFDIs totales",
    errors: "Errores",
    phase: "Fase",
    total_fetched: "Total obtenidos",
  };
  return labels[key] || key;
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

      // If we have a specific sync log ID, find it
      if (syncLogId && data.logs) {
        const found = data.logs.find((l: SyncLog) => l.id === syncLogId);
        if (found) setActiveLog(found);
      } else if (data.logs?.length > 0) {
        setActiveLog(data.logs[0]);
      }
    } catch {
      // Silently fail — logs are informational
    }
  }, [provider, syncLogId]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Poll while running
  useEffect(() => {
    if (!isRunning && activeLog?.status !== "running") return;
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, [isRunning, activeLog?.status, fetchLogs]);

  if (!activeLog && logs.length === 0) return null;

  const log = activeLog || logs[0];
  if (!log) return null;

  const progress = log.total_items > 0
    ? Math.round((log.processed_items / log.total_items) * 100)
    : log.status === "running" ? undefined : 100;

  const details = (log.details || {}) as Record<string, unknown>;
  const detailEntries = Object.entries(details).filter(
    ([key]) => key !== "phase" && key !== "total_fetched",
  );
  const phase = details.phase as string | undefined;

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
        {/* Progress bar */}
        {log.status === "running" && (
          <div className="space-y-1.5">
            {phase && (
              <p className="text-xs text-muted-foreground">
                Procesando: <span className="font-medium">{detailsLabel(phase)}</span>
              </p>
            )}
            <Progress value={progress} className="h-2" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{log.processed_items} procesados</span>
              {log.total_items > 0 && <span>de {log.total_items}</span>}
            </div>
          </div>
        )}

        {/* Completed stats */}
        {log.status !== "running" && detailEntries.length > 0 && (
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
