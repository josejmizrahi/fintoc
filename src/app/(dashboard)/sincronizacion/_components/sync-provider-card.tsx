"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Loader2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { api } from "@/lib/api";
import { formatRelative } from "@/lib/utils/format";

interface SyncProviderCardProps {
  provider: string;
  name: string;
  description: string;
  isConnected: boolean;
  lastSyncAt?: string;
  lastSyncStatus?: string;
  lastSyncMessage?: string;
  recordsSynced?: number;
  onSyncComplete?: () => void;
}

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: typeof CheckCircle2 }> = {
  completed: { label: "Completado", variant: "default", icon: CheckCircle2 },
  partial: { label: "Parcial", variant: "outline", icon: AlertTriangle },
  failed: { label: "Error", variant: "destructive", icon: XCircle },
  running: { label: "En proceso", variant: "secondary", icon: Loader2 },
  connected: { label: "Conectado", variant: "default", icon: CheckCircle2 },
  configured: { label: "Configurado", variant: "default", icon: CheckCircle2 },
  error: { label: "Error", variant: "destructive", icon: XCircle },
  warning: { label: "Advertencia", variant: "outline", icon: AlertTriangle },
  disconnected: { label: "Desconectado", variant: "secondary", icon: XCircle },
};

export function SyncProviderCard({
  provider,
  name,
  description,
  isConnected,
  lastSyncAt,
  lastSyncStatus,
  lastSyncMessage,
  recordsSynced,
  onSyncComplete,
}: SyncProviderCardProps) {
  const queryClient = useQueryClient();
  const [isSyncing, setIsSyncing] = useState(false);

  const syncMutation = useMutation({
    mutationFn: () => api.sync.trigger(provider),
    onSuccess: (data) => {
      setIsSyncing(false);
      if (data.success) {
        const result = data.data;
        const msg = result?.recordsSynced != null
          ? `${name}: ${result.recordsSynced} registros sincronizados`
          : result?.message || `${name}: sincronizacion completada`;
        toast.success(msg);
      } else {
        const errMsg = data.data?.errors?.[0]?.message || data.message || "Error de sincronizacion";
        toast.error(`${name}: ${errMsg}`);
      }
      queryClient.invalidateQueries({ queryKey: ["sync", "status"] });
      onSyncComplete?.();
    },
    onError: (err: Error) => {
      setIsSyncing(false);
      toast.error(`${name}: ${err.message || "Error de sincronizacion"}`);
    },
  });

  const partnersMutation = useMutation({
    mutationFn: () => api.sync.odooPartners(),
    onSuccess: (data: { data?: { vendors_synced?: number; customers_synced?: number; errors?: string[] } }) => {
      const d = data?.data;
      const vendors = d?.vendors_synced ?? 0;
      const customers = d?.customers_synced ?? 0;
      toast.success(`Proveedores: ${vendors}, Clientes: ${customers}`);
      queryClient.invalidateQueries({ queryKey: ["sync", "status"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Error al sincronizar proveedores");
    },
  });

  const statusInfo = STATUS_MAP[lastSyncStatus || ""] || STATUS_MAP.disconnected;
  const StatusIcon = statusInfo.icon;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base">{name}</CardTitle>
            <CardDescription className="mt-0.5 text-xs">
              {description}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isConnected ? (
              <Badge className="bg-green-600 text-white">Conectado</Badge>
            ) : (
              <Badge variant="secondary">Desconectado</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Status info */}
        <div className="flex items-center gap-2 text-sm">
          <StatusIcon className={`size-4 shrink-0 ${lastSyncStatus === 'running' ? 'animate-spin' : ''} ${
            statusInfo.variant === 'destructive' ? 'text-destructive' :
            statusInfo.variant === 'default' ? 'text-green-600' : 'text-muted-foreground'
          }`} />
          <span className="text-muted-foreground">
            {lastSyncMessage || (isConnected ? "Listo para sincronizar" : "No configurado")}
          </span>
        </div>

        {/* Last sync info */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {lastSyncAt && (
            <div className="flex items-center gap-1">
              <Clock className="size-3" />
              Ultima sync: {formatRelative(lastSyncAt)}
            </div>
          )}
          {recordsSynced != null && recordsSynced > 0 && (
            <span>{recordsSynced} registros</span>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            onClick={() => {
              setIsSyncing(true);
              syncMutation.mutate();
            }}
            disabled={!isConnected || isSyncing || syncMutation.isPending}
          >
            {isSyncing || syncMutation.isPending ? (
              <Loader2 className="size-3.5 animate-spin mr-1.5" />
            ) : (
              <RefreshCw className="size-3.5 mr-1.5" />
            )}
            Sincronizar
          </Button>
          {provider === "odoo" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => partnersMutation.mutate()}
              disabled={!isConnected || partnersMutation.isPending}
            >
              {partnersMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin mr-1.5" />
              ) : (
                <RefreshCw className="size-3.5 mr-1.5" />
              )}
              Proveedores y clientes
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
