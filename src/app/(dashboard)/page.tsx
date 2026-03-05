'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CreditCard,
  ArrowRight,
  Plug,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { formatMoney, formatDate, formatRelative } from '@/lib/utils/format';
import { StatusBadge } from '@/components/shared/status-badge';
import { KpiCard } from '@/components/shared/kpi-card';
import { EmptyState } from '@/components/shared/empty-state';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from 'recharts';

export default function DashboardPage() {
  const [period, setPeriod] = useState<'7d' | '30d' | '90d' | '12m'>('30d');
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const { data: dashboard, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.dashboard(),
    staleTime: 30_000,
    enabled: isAuthenticated,
  });

  const { data: cashFlow, isLoading: cashFlowLoading } = useQuery({
    queryKey: ['dashboard', 'cash-flow', period],
    queryFn: () => api.reports.cashFlow({ period }),
    staleTime: 60_000,
    enabled: isAuthenticated,
  });

  const { data: onboarding } = useQuery({
    queryKey: ['onboarding', 'status'],
    queryFn: () => api.onboarding.status(),
    staleTime: 300_000,
    enabled: isAuthenticated,
  });

  const showOnboarding = onboarding && !onboarding.onboarding_completed;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const data = dashboard || {};

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>

      {showOnboarding && (
        <Link href="/onboarding">
          <Card className="border-primary/30 bg-primary/5 cursor-pointer hover:bg-primary/10 transition-colors">
            <CardContent className="flex items-center gap-4 py-4">
              <Plug className="size-5 text-primary" />
              <div className="flex-1">
                <p className="font-medium">Conecta tus servicios</p>
                <p className="text-sm text-muted-foreground">
                  Configura Odoo, Fintoc y SAT para sincronizar tus datos automaticamente.
                </p>
              </div>
              <Badge variant="secondary">Configurar</Badge>
            </CardContent>
          </Card>
        </Link>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          title="Saldo Actual"
          value={formatMoney(data.total_balance ?? 0)}
          icon={DollarSign}
          trend={(data.total_balance ?? 0) >= 0 ? 'up' : 'down'}
        />
        <KpiCard
          title="Por Cobrar"
          value={formatMoney(data.accounts_receivable ?? 0)}
          icon={TrendingUp}
          description={`${data.pending_invoices_count ?? 0} facturas`}
        />
        <KpiCard
          title="Por Pagar"
          value={formatMoney(data.accounts_payable ?? 0)}
          icon={TrendingDown}
          description={`${data.pending_bills_count ?? 0} facturas`}
        />
        <KpiCard
          title="Vencidas"
          value={formatMoney(data.overdue_amount ?? 0)}
          icon={AlertTriangle}
          description={`${data.overdue_invoices ?? 0} facturas`}
          destructive={(data.overdue_invoices ?? 0) > 0}
        />
      </div>

      {/* Cash Flow Chart */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Flujo de Caja</CardTitle>
          <div className="flex gap-1">
            {(['7d', '30d', '90d', '12m'] as const).map((p) => (
              <Button
                key={p}
                variant={period === p ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setPeriod(p)}
              >
                {p}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {cashFlowLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : cashFlow?.data?.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={cashFlow.data}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="date" className="text-xs" />
                <YAxis className="text-xs" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <RechartsTooltip formatter={(value) => formatMoney(Number(value))} />
                <Area type="monotone" dataKey="ingresos" stroke="#22c55e" fill="#22c55e" fillOpacity={0.1} name="Ingresos" />
                <Area type="monotone" dataKey="egresos" stroke="#ef4444" fill="#ef4444" fillOpacity={0.1} name="Egresos" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
              Sin datos de flujo de caja para este periodo
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Payments + Overdue Invoices */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Pagos Recientes</CardTitle>
            <Link href="/pagos">
              <Button variant="ghost" size="sm">
                Ver todos <ArrowRight className="ml-1 size-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {data.recent_payments?.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Concepto</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recent_payments.slice(0, 5).map((p: any) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <div className="font-medium text-sm">{p.partner_name || p.reference_id || `PAY-${p.id}`}</div>
                        <div className="text-xs text-muted-foreground">
                          {p.executed_at ? formatDate(p.executed_at) : p.created_at ? formatDate(p.created_at) : ''}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatMoney(p.amount)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={p.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState
                icon={CreditCard}
                title="No hay pagos recientes"
                description="Los pagos apareceran aqui al crearlos."
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Facturas Vencidas</CardTitle>
            <Link href="/facturas?status=overdue">
              <Button variant="ghost" size="sm">
                Ver todas <ArrowRight className="ml-1 size-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {data.overdue_invoice_list?.length > 0 ? (
              <div className="space-y-3">
                {data.overdue_invoice_list.slice(0, 5).map((inv: any) => (
                  <div key={inv.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div>
                      <div className="font-medium text-sm">{inv.partner_name || inv.name}</div>
                      <div className="text-xs text-muted-foreground">{inv.name}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm">
                        {formatMoney(inv.amount_residual ?? inv.amount_total ?? 0)}
                      </div>
                      {inv.date_due && (
                        <Badge variant="destructive" className="text-[10px]">
                          {Math.max(0, Math.ceil((Date.now() - new Date(inv.date_due).getTime()) / 86400000))} dias
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={AlertTriangle}
                title="Sin facturas vencidas"
                description="No hay facturas vencidas por el momento."
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
