'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Clock,
  ArrowRight,
  Database,
  Landmark,
  FileText,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface ProviderStatus {
  is_connected: boolean;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_message: string | null;
  is_syncing: boolean;
  last_sync: {
    id: string;
    status: string;
    records_synced: number | null;
    error_message: string | null;
    started_at: string;
    completed_at: string | null;
  } | null;
}

interface Extraction {
  id: string;
  syntage_extraction_id: string;
  extractor: string;
  status: string;
  records_found: number | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

const PROVIDER_CONFIG = {
  odoo: { label: 'Odoo', icon: Database, href: '/configuracion', color: 'text-purple-600' },
  fintoc: { label: 'Fintoc', icon: Landmark, href: '/configuracion', color: 'text-blue-600' },
  sat: { label: 'SAT', icon: FileText, href: '/sat', color: 'text-green-600' },
} as const;

const EXTRACTOR_LABELS: Record<string, string> = {
  invoices: 'Facturas',
  tax_returns: 'Declaraciones',
  tax_status: 'Constancia fiscal',
  tax_compliance_checks: 'Opinion cumplimiento',
  tax_retentions: 'Retenciones',
  electronic_accounting: 'Contabilidad electronica',
  sat_certificates: 'Certificados',
  expense_receipts: 'Gastos',
  accounting_data: 'Datos contables',
  annual_tax_return: 'Declaracion anual',
  monthly_tax_return: 'Declaracion mensual',
};

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `hace ${days}d`;
}

function SyncStatusIcon({ status, isSyncing }: { status: string | null; isSyncing: boolean }) {
  if (isSyncing) {
    return <Loader2 className="size-4 text-blue-500 animate-spin" />;
  }
  switch (status) {
    case 'connected':
    case 'configured':
    case 'success':
    case 'completed':
      return <CheckCircle2 className="size-4 text-green-500" />;
    case 'error':
    case 'failed':
      return <XCircle className="size-4 text-destructive" />;
    case 'warning':
      return <AlertTriangle className="size-4 text-yellow-500" />;
    case 'disconnected':
      return <XCircle className="size-4 text-muted-foreground" />;
    default:
      return <Clock className="size-4 text-muted-foreground" />;
  }
}

function ProviderCard({ provider, status }: { provider: keyof typeof PROVIDER_CONFIG; status: ProviderStatus }) {
  const config = PROVIDER_CONFIG[provider];
  const Icon = config.icon;

  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className={`shrink-0 ${config.color}`}>
        <Icon className="size-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{config.label}</span>
          {!status.is_connected && (
            <Badge variant="outline" className="text-[10px] px-1.5">No conectado</Badge>
          )}
        </div>
        {status.is_connected && (
          <div className="flex items-center gap-1.5 mt-0.5">
            <SyncStatusIcon status={status.last_sync_status} isSyncing={status.is_syncing} />
            <span className="text-xs text-muted-foreground truncate">
              {status.is_syncing
                ? 'Sincronizando...'
                : status.last_sync_message
                  ? status.last_sync_message.slice(0, 60)
                  : status.last_sync_at
                    ? `Ultima sync ${formatRelativeTime(status.last_sync_at)}`
                    : 'Sin sincronizar'}
            </span>
          </div>
        )}
      </div>
      {status.is_syncing && (
        <RefreshCw className="size-3.5 text-blue-500 animate-spin shrink-0" />
      )}
    </div>
  );
}

function ExtractionItem({ extraction }: { extraction: Extraction }) {
  const label = EXTRACTOR_LABELS[extraction.extractor] || extraction.extractor;
  const isActive = ['pending', 'waiting', 'running'].includes(extraction.status);

  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{label}</span>
          <ExtractionStatusBadge status={extraction.status} />
        </div>
        {extraction.records_found != null && extraction.status === 'finished' && (
          <span className="text-[11px] text-muted-foreground">
            {extraction.records_found} registros
          </span>
        )}
      </div>
      {isActive && (
        <Loader2 className="size-3 text-blue-500 animate-spin shrink-0" />
      )}
    </div>
  );
}

function ExtractionStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'running':
      return <Badge variant="secondary" className="text-[10px] px-1.5 animate-pulse bg-blue-100 text-blue-700">Ejecutando</Badge>;
    case 'pending':
      return <Badge variant="outline" className="text-[10px] px-1.5">Pendiente</Badge>;
    case 'waiting':
      return <Badge variant="secondary" className="text-[10px] px-1.5 bg-yellow-100 text-yellow-700">Esperando</Badge>;
    case 'finished':
      return <Badge variant="secondary" className="text-[10px] px-1.5 bg-green-100 text-green-700">Completado</Badge>;
    case 'failed':
      return <Badge variant="destructive" className="text-[10px] px-1.5">Error</Badge>;
    case 'stopped':
    case 'cancelled':
      return <Badge variant="outline" className="text-[10px] px-1.5 text-muted-foreground">Detenido</Badge>;
    default:
      return <Badge variant="outline" className="text-[10px] px-1.5">{status}</Badge>;
  }
}

export function IntegrationSyncStatus() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'integrations'],
    queryFn: () => api.dashboardIntegrations(),
    staleTime: 15_000,
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return false;
      // Poll every 5s when there are active syncs or extractions
      const hasActive =
        Object.values(d.integrations || {}).some((p: any) => p.is_syncing) ||
        (d.extractions?.active?.length > 0);
      return hasActive ? 5_000 : 30_000;
    },
    enabled: isAuthenticated,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const integrations = data.integrations || {};
  const activeExtractions: Extraction[] = data.extractions?.active || [];
  const recentExtractions: Extraction[] = data.extractions?.recent || [];
  const hasAnyConnected = Object.values(integrations).some((p: any) => p.is_connected);

  if (!hasAnyConnected && activeExtractions.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">Integraciones</CardTitle>
        <Link href="/configuracion">
          <Button variant="ghost" size="sm" className="text-xs">
            Configurar <ArrowRight className="ml-1 size-3.5" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent className="space-y-1">
        <TooltipProvider>
          {/* Provider status rows */}
          {(['odoo', 'fintoc', 'sat'] as const).map((provider) => {
            const status = integrations[provider] as ProviderStatus | undefined;
            if (!status?.is_connected) return null;
            return (
              <Tooltip key={provider}>
                <TooltipTrigger asChild>
                  <Link href={PROVIDER_CONFIG[provider].href} className="block hover:bg-muted/50 rounded-md px-2 -mx-2 transition-colors">
                    <ProviderCard provider={provider} status={status} />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-[300px]">
                  <p className="text-xs">{status.last_sync_message || 'Sin informacion de sync'}</p>
                  {status.last_sync?.error_message && (
                    <p className="text-xs text-destructive mt-1">{status.last_sync.error_message}</p>
                  )}
                </TooltipContent>
              </Tooltip>
            );
          })}

          {/* Active extractions */}
          {activeExtractions.length > 0 && (
            <div className="pt-2 mt-2 border-t">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-muted-foreground">Extracciones SAT activas</span>
                <Link href="/sat">
                  <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5">
                    Ver <ArrowRight className="ml-0.5 size-3" />
                  </Button>
                </Link>
              </div>
              {activeExtractions.slice(0, 5).map((ext) => (
                <ExtractionItem key={ext.id} extraction={ext} />
              ))}
              {activeExtractions.length > 5 && (
                <span className="text-[11px] text-muted-foreground">
                  +{activeExtractions.length - 5} mas en progreso
                </span>
              )}
            </div>
          )}

          {/* Recent completed extractions */}
          {activeExtractions.length === 0 && recentExtractions.length > 0 && (
            <div className="pt-2 mt-2 border-t">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-muted-foreground">Extracciones recientes</span>
                <Link href="/sat">
                  <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5">
                    Ver <ArrowRight className="ml-0.5 size-3" />
                  </Button>
                </Link>
              </div>
              {recentExtractions.slice(0, 3).map((ext) => (
                <ExtractionItem key={ext.id} extraction={ext} />
              ))}
            </div>
          )}
        </TooltipProvider>
      </CardContent>
    </Card>
  );
}
