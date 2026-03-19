"use client";

import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, RefreshCw, Loader2 } from "lucide-react";

import { PermissionGate } from "@/components/shared/permission-gate";
import { KpiCard } from "@/components/shared/kpi-card";
import { api } from "@/lib/api";

import { SyncProviderCard } from "./_components/sync-provider-card";
import { SyncHistoryTable } from "./_components/sync-history-table";

const PROVIDERS = [
  {
    key: "odoo",
    name: "Odoo ERP",
    description:
      "Facturas, proveedores y clientes desde tu instancia de Odoo.",
  },
  {
    key: "fintoc",
    name: "Fintoc / Banco",
    description:
      "Movimientos bancarios, saldos y pagos SPEI en tiempo real.",
  },
  {
    key: "sat",
    name: "SAT / Syntage",
    description:
      "CFDIs, declaraciones, situacion fiscal y lista EFOS del SAT.",
    syncProvider: "syntage",
  },
] as const;

export default function SincronizacionPage() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["sync", "status"],
    queryFn: () => api.sync.status(),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const integrations = (data?.data?.integrations || []) as Array<{
    provider: string;
    status: string;
    is_connected: boolean;
    last_sync: string;
    last_sync_at: string;
    last_sync_status: string;
  }>;
  const recentSyncs = (data?.data?.recentSyncs || []) as Array<{
    provider: string;
    status: string;
    records_synced: number;
  }>;

  const connectedCount = integrations.filter((i) => i.is_connected).length;
  const totalSynced = recentSyncs.reduce(
    (sum, s) => sum + (s.records_synced || 0),
    0
  );
  const failedCount = recentSyncs.filter((s) => s.status === "failed").length;

  const getIntegration = (provider: string) =>
    integrations.find((i) => i.provider === provider);

  return (
    <PermissionGate
      permission="sync:execute"
      fallback={
        <div className="flex flex-col items-center justify-center gap-4 py-24 text-muted-foreground">
          <ShieldAlert className="size-12" />
          <p className="text-lg font-medium">Acceso restringido</p>
          <p className="text-sm">
            No tienes permisos para gestionar sincronizaciones.
          </p>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Sincronizacion
          </h1>
          <p className="text-sm text-muted-foreground">
            Gestiona la sincronizacion de datos con Odoo, Fintoc y SAT/Syntage.
          </p>
        </div>

        {/* KPIs */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            <KpiCard
              title="Integraciones activas"
              value={`${connectedCount} / ${PROVIDERS.length}`}
              icon={RefreshCw}
              description="conectadas"
            />
            <KpiCard
              title="Registros sincronizados"
              value={totalSynced}
              icon={RefreshCw}
              description="ultimas sincronizaciones"
            />
            <KpiCard
              title="Errores recientes"
              value={failedCount}
              icon={RefreshCw}
              description="sincronizaciones fallidas"
              destructive={failedCount > 0}
            />
          </div>
        )}

        {/* Provider Cards */}
        <div>
          <h2 className="text-lg font-semibold mb-3">Proveedores</h2>
          <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
            {PROVIDERS.map(({ key, name, description, ...rest }) => {
              const syncProvider = "syncProvider" in rest ? rest.syncProvider : key;
              const integration = getIntegration(key);
              return (
                <SyncProviderCard
                  key={key}
                  provider={syncProvider}
                  name={name}
                  description={description}
                  isConnected={integration?.is_connected ?? false}
                  lastSyncAt={integration?.last_sync_at}
                  lastSyncStatus={integration?.last_sync_status}
                  onSyncComplete={() => refetch()}
                />
              );
            })}
          </div>
        </div>

        {/* Sync History */}
        <SyncHistoryTable />
      </div>
    </PermissionGate>
  );
}
