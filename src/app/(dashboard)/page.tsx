"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Activity,
  FileText,
  AlertTriangle,
  CheckCircle,
  Shield,
  Plug,
} from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { DashboardData } from "@/types";

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(amount);
}

function statusBadgeVariant(
  status: string
): "default" | "secondary" | "destructive" {
  const s = status.toLowerCase();
  if (s === "completed" || s === "paid") return "default";
  if (s === "pending") return "secondary";
  if (s === "failed") return "destructive";
  return "secondary";
}

function KPISkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="h-4 w-24 bg-muted animate-pulse rounded" />
            <div className="h-4 w-4 bg-muted animate-pulse rounded" />
          </CardHeader>
          <CardContent>
            <div className="h-7 w-32 bg-muted animate-pulse rounded" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-10 w-full bg-muted animate-pulse rounded" />
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    api
      .dashboard()
      .then((res: DashboardData) => {
        setData(res);
      })
      .catch((err: Error) => {
        setError(err.message || "Error al cargar el dashboard");
      })
      .finally(() => {
        setLoading(false);
      });
    // Check onboarding status
    api.onboarding.status().then((res) => {
      if (!res.onboarding_completed) setShowOnboarding(true);
    }).catch(() => {});
  }, []);

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="p-6 space-y-6">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <KPISkeleton />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Pagos Recientes</CardTitle>
            </CardHeader>
            <CardContent>
              <TableSkeleton />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Facturas Vencidas</CardTitle>
            </CardHeader>
            <CardContent>
              <TableSkeleton />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const kpis = [
    {
      title: "Saldo Total",
      value: formatCurrency(data.total_balance),
      icon: DollarSign,
      destructive: false,
    },
    {
      title: "Cuentas por Cobrar",
      value: formatCurrency(data.accounts_receivable),
      icon: TrendingUp,
      destructive: false,
    },
    {
      title: "Cuentas por Pagar",
      value: formatCurrency(data.accounts_payable),
      icon: TrendingDown,
      destructive: false,
    },
    {
      title: "Posición Neta",
      value: formatCurrency(data.net_position),
      icon: Activity,
      destructive: false,
    },
    {
      title: "Facturas Pendientes",
      value: data.pending_invoices_count.toString(),
      icon: FileText,
      destructive: false,
    },
    {
      title: "Facturas Vencidas",
      value: data.overdue_invoices.toString(),
      icon: AlertTriangle,
      destructive: data.overdue_invoices > 0,
    },
    {
      title: "Aprobaciones Pendientes",
      value: data.pending_approvals.toString(),
      icon: CheckCircle,
      destructive: false,
    },
    {
      title: "Alertas SAT",
      value: data.sat_issues.toString(),
      icon: Shield,
      destructive: false,
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>

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
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.title}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {kpi.title}
                </CardTitle>
                <Icon
                  className={`h-4 w-4 ${
                    kpi.destructive
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }`}
                />
              </CardHeader>
              <CardContent>
                <div
                  className={`text-2xl font-bold ${
                    kpi.destructive ? "text-destructive" : ""
                  }`}
                >
                  {kpi.value}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Tables Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pagos Recientes */}
        <Card>
          <CardHeader>
            <CardTitle>Pagos Recientes</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Referencia</TableHead>
                  <TableHead>Monto</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Fecha</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recent_payments && data.recent_payments.length > 0 ? (
                  data.recent_payments.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell className="font-medium">
                        {payment.reference_id || `PAY-${payment.id}`}
                      </TableCell>
                      <TableCell>{formatCurrency(payment.amount)}</TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(payment.status)}>
                          {payment.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {payment.executed_at
                          ? new Date(payment.executed_at).toLocaleDateString(
                              "es-MX"
                            )
                          : payment.created_at
                            ? new Date(payment.created_at).toLocaleDateString(
                                "es-MX"
                              )
                            : "—"}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-center text-muted-foreground"
                    >
                      No hay pagos recientes
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Facturas Vencidas */}
        <Card>
          <CardHeader>
            <CardTitle>Facturas Vencidas</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Factura</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Monto</TableHead>
                  <TableHead>Vencimiento</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.overdue_invoice_list &&
                data.overdue_invoice_list.length > 0 ? (
                  data.overdue_invoice_list.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-medium">
                        {invoice.name}
                      </TableCell>
                      <TableCell>{invoice.partner || "—"}</TableCell>
                      <TableCell>
                        {formatCurrency(
                          invoice.amount_residual ??
                            invoice.amount_total ??
                            invoice.amount ??
                            0
                        )}
                      </TableCell>
                      <TableCell>
                        {invoice.invoice_date_due
                          ? new Date(
                              invoice.invoice_date_due
                            ).toLocaleDateString("es-MX")
                          : invoice.due_date
                            ? new Date(invoice.due_date).toLocaleDateString(
                                "es-MX"
                              )
                            : "—"}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-center text-muted-foreground"
                    >
                      No hay facturas vencidas
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
