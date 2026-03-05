"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp,
  Clock,
  ShieldCheck,
  BarChart3,
  Users,
  UserCheck,
  ArrowLeft,
  Download,
  FileSpreadsheet,
  FileText,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { EmptyState } from "@/components/shared/empty-state";
import { KpiCard } from "@/components/shared/kpi-card";
import { PermissionGate } from "@/components/shared/permission-gate";

import { api } from "@/lib/api";
import {
  useCashFlowReport,
  useAgingReport,
  useSatComplianceReport,
  useBudgetVsActualReport,
  useVendorSummaryReport,
  useCustomerSummaryReport,
} from "@/lib/hooks/use-reports";
import { formatMoney } from "@/lib/utils/format";

/* ---------- Types ---------- */

type ReportType =
  | "cash-flow"
  | "aging"
  | "sat-compliance"
  | "budget-vs-actual"
  | "vendor-summary"
  | "customer-summary";

type Period = "week" | "month" | "quarter" | "year";

const PERIOD_LABELS: Record<Period, string> = {
  week: "Semana",
  month: "Mes",
  quarter: "Trimestre",
  year: "Anual",
};

const PIE_COLORS = ["#16a34a", "#dc2626", "#f59e0b", "#2563eb", "#8b5cf6"];

interface ReportCardDef {
  key: ReportType;
  title: string;
  description: string;
  icon: React.ElementType;
  chartType: "area" | "bar" | "pie" | "table";
}

const REPORT_CARDS: ReportCardDef[] = [
  {
    key: "cash-flow",
    title: "Flujo de Caja",
    description: "Analisis de ingresos y egresos por periodo.",
    icon: TrendingUp,
    chartType: "area",
  },
  {
    key: "aging",
    title: "Aging de Saldos",
    description: "Antiguedad de cuentas por cobrar y pagar.",
    icon: Clock,
    chartType: "bar",
  },
  {
    key: "sat-compliance",
    title: "Cumplimiento SAT",
    description: "Metricas de cumplimiento fiscal y validacion CFDI.",
    icon: ShieldCheck,
    chartType: "pie",
  },
  {
    key: "budget-vs-actual",
    title: "Presupuesto vs Real",
    description: "Comparacion de presupuestos contra gastos reales.",
    icon: BarChart3,
    chartType: "bar",
  },
  {
    key: "vendor-summary",
    title: "Resumen Proveedor",
    description: "Resumen de pagos y saldos por proveedor.",
    icon: Users,
    chartType: "table",
  },
  {
    key: "customer-summary",
    title: "Resumen Cliente",
    description: "Resumen de cobros y saldos por cliente.",
    icon: UserCheck,
    chartType: "table",
  },
];

/* ---------- Chart Tooltip ---------- */

function ChartTooltipContent({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="mb-1 text-sm font-medium">{label}</p>
      {payload.map((entry: any) => (
        <p key={entry.name} className="text-xs" style={{ color: entry.color }}>
          {entry.name}: {formatMoney(entry.value)}
        </p>
      ))}
    </div>
  );
}

/* ---------- Report Detail View ---------- */

function ReportDetail({
  report,
  period,
  setPeriod,
  onBack,
}: {
  report: ReportCardDef;
  period: Period;
  setPeriod: (p: Period) => void;
  onBack: () => void;
}) {
  const periodParams = useMemo(() => ({ period }), [period]);

  /* Conditional queries based on report type */
  const cashFlow = useCashFlowReport(
    report.key === "cash-flow" ? periodParams : {}
  );
  const aging = useAgingReport(report.key === "aging" ? periodParams : {});
  const sat = useSatComplianceReport(
    report.key === "sat-compliance" ? periodParams : {}
  );
  const budgetVsActual = useBudgetVsActualReport();
  const vendorSummary = useVendorSummaryReport();
  const customerSummary = useCustomerSummaryReport();

  const isLoading =
    (report.key === "cash-flow" && cashFlow.isLoading) ||
    (report.key === "aging" && aging.isLoading) ||
    (report.key === "sat-compliance" && sat.isLoading) ||
    (report.key === "budget-vs-actual" && budgetVsActual.isLoading) ||
    (report.key === "vendor-summary" && vendorSummary.isLoading) ||
    (report.key === "customer-summary" && customerSummary.isLoading);

  function getData(): any {
    switch (report.key) {
      case "cash-flow":
        return cashFlow.data;
      case "aging":
        return aging.data;
      case "sat-compliance":
        return sat.data;
      case "budget-vs-actual":
        return budgetVsActual.data;
      case "vendor-summary":
        return vendorSummary.data;
      case "customer-summary":
        return customerSummary.data;
      default:
        return null;
    }
  }

  const data = getData();

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4 mr-1" />
          Volver
        </Button>
        <div className="flex-1">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <report.icon className="size-5" />
            {report.title}
          </h2>
          <p className="text-sm text-muted-foreground">{report.description}</p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
        <Select
          value={period}
          onValueChange={(v) => setPeriod(v as Period)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
              <SelectItem key={p} value={p}>
                {PERIOD_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <FileText className="size-4 mr-1" />
            PDF
          </Button>
          <Button variant="outline" size="sm">
            <FileSpreadsheet className="size-4 mr-1" />
            Excel
          </Button>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <span className="text-sm text-muted-foreground">
            Cargando reporte...
          </span>
        </div>
      )}

      {/* Cash Flow Area Chart */}
      {report.key === "cash-flow" && !isLoading && data && (
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div>
                <p className="text-sm text-muted-foreground">Total Ingresos</p>
                <p className="text-lg font-bold text-green-600">
                  {formatMoney(data.total_inflows ?? data.inflows ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Egresos</p>
                <p className="text-lg font-bold text-red-600">
                  {formatMoney(data.total_outflows ?? data.outflows ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Flujo Neto</p>
                <p className="text-lg font-bold">
                  {formatMoney(data.net_flow ?? data.net ?? 0)}
                </p>
              </div>
            </div>
            {Array.isArray(data.details || data.entries) && (
              <div className="h-[350px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={data.details || data.entries}
                    margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis
                      tick={{ fontSize: 12 }}
                      tickFormatter={(v) =>
                        new Intl.NumberFormat("es-MX", {
                          notation: "compact",
                          style: "currency",
                          currency: "MXN",
                        }).format(v)
                      }
                    />
                    <Tooltip content={<ChartTooltipContent />} />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="inflows"
                      name="Ingresos"
                      stroke="#16a34a"
                      fill="#16a34a20"
                    />
                    <Area
                      type="monotone"
                      dataKey="outflows"
                      name="Egresos"
                      stroke="#dc2626"
                      fill="#dc262620"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Aging Bar Chart */}
      {report.key === "aging" && !isLoading && data && (
        <Card>
          <CardContent className="pt-6">
            {Array.isArray(data.buckets || data) && (
              <div className="h-[350px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data.buckets || data}
                    margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="range"
                      tick={{ fontSize: 12 }}
                    />
                    <YAxis
                      tick={{ fontSize: 12 }}
                      tickFormatter={(v) =>
                        new Intl.NumberFormat("es-MX", {
                          notation: "compact",
                          style: "currency",
                          currency: "MXN",
                        }).format(v)
                      }
                    />
                    <Tooltip content={<ChartTooltipContent />} />
                    <Bar
                      dataKey="amount"
                      name="Monto"
                      fill="#2563eb"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {/* Table below */}
            {Array.isArray(data.buckets || data) && (
              <Table className="mt-4">
                <TableHeader>
                  <TableRow>
                    <TableHead>Rango</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead className="text-right">Facturas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data.buckets || data).map((b: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">
                        {b.range || b.bucket || b.label || "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatMoney(b.amount ?? b.total ?? 0)}
                      </TableCell>
                      <TableCell className="text-right">
                        {b.count ?? b.invoices ?? "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* SAT Compliance Pie / Stats */}
      {report.key === "sat-compliance" && !isLoading && data && (
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div>
                <p className="text-sm text-muted-foreground">Total Documentos</p>
                <p className="text-lg font-bold">
                  {data.total_documents ?? data.total ?? "-"}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Vigentes</p>
                <p className="text-lg font-bold text-green-600">
                  {data.valid ?? data.vigentes ?? "-"}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Cancelados</p>
                <p className="text-lg font-bold text-red-600">
                  {data.cancelled ?? data.cancelados ?? "-"}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Tasa Cumplimiento</p>
                <p className="text-lg font-bold">
                  {data.compliance_rate != null
                    ? `${data.compliance_rate.toFixed(1)}%`
                    : data.compliance_pct != null
                    ? `${data.compliance_pct.toFixed(1)}%`
                    : "-"}
                </p>
              </div>
            </div>
            {/* Pie chart */}
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[
                      {
                        name: "Vigentes",
                        value: data.valid ?? data.vigentes ?? 0,
                      },
                      {
                        name: "Cancelados",
                        value: data.cancelled ?? data.cancelados ?? 0,
                      },
                      {
                        name: "Sin validar",
                        value: data.unvalidated ?? data.pending ?? 0,
                      },
                    ].filter((d) => d.value > 0)}
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    dataKey="value"
                    label={({ name, percent }) =>
                      `${name} (${((percent ?? 0) * 100).toFixed(0)}%)`
                    }
                  >
                    {PIE_COLORS.map((color, i) => (
                      <Cell key={i} fill={color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Budget vs Actual */}
      {report.key === "budget-vs-actual" &&
        !isLoading &&
        Array.isArray(data) && (
          <Card>
            <CardContent className="pt-6">
              <div className="h-[350px] mb-6">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data.map((item: any) => ({
                      name: item.category || item.name || "-",
                      Presupuestado:
                        item.amount_budgeted ?? item.budgeted ?? 0,
                      Real: item.amount_spent ?? item.actual ?? 0,
                    }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis
                      tick={{ fontSize: 12 }}
                      tickFormatter={(v) =>
                        new Intl.NumberFormat("es-MX", {
                          notation: "compact",
                          style: "currency",
                          currency: "MXN",
                        }).format(v)
                      }
                    />
                    <Tooltip content={<ChartTooltipContent />} />
                    <Legend />
                    <Bar dataKey="Presupuestado" fill="#2563eb" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Real" fill="#dc2626" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Presupuesto</TableHead>
                    <TableHead className="text-right">Presupuestado</TableHead>
                    <TableHead className="text-right">Actual</TableHead>
                    <TableHead className="text-right">Variacion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((item: any, idx: number) => {
                    const budgeted =
                      item.amount_budgeted ?? item.budgeted ?? 0;
                    const spent = item.amount_spent ?? item.actual ?? 0;
                    const variance = budgeted - spent;
                    return (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">
                          {item.name || item.category || "-"}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatMoney(budgeted)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatMoney(spent)}
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono ${
                            variance >= 0 ? "text-green-600" : "text-red-600"
                          }`}
                        >
                          {formatMoney(variance)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

      {/* Vendor Summary */}
      {report.key === "vendor-summary" &&
        !isLoading &&
        Array.isArray(data) && (
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Proveedor</TableHead>
                    <TableHead>RFC</TableHead>
                    <TableHead className="text-right">Total Pagado</TableHead>
                    <TableHead className="text-right">Pendiente</TableHead>
                    <TableHead className="text-right">Facturas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((v: any, idx: number) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">
                        {v.name || v.vendor_name || "-"}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {v.rfc || v.vat || "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatMoney(v.total_paid ?? v.paid ?? 0)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatMoney(v.total_pending ?? v.pending ?? 0)}
                      </TableCell>
                      <TableCell className="text-right">
                        {v.invoice_count ?? v.bills ?? "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

      {/* Customer Summary */}
      {report.key === "customer-summary" &&
        !isLoading &&
        Array.isArray(data) && (
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>RFC</TableHead>
                    <TableHead className="text-right">Total Cobrado</TableHead>
                    <TableHead className="text-right">Pendiente</TableHead>
                    <TableHead className="text-right">Facturas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((c: any, idx: number) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">
                        {c.name || c.customer_name || "-"}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {c.rfc || c.vat || "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatMoney(c.total_collected ?? c.collected ?? 0)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatMoney(c.total_pending ?? c.pending ?? 0)}
                      </TableCell>
                      <TableCell className="text-right">
                        {c.invoice_count ?? c.invoices ?? "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
    </div>
  );
}

/* ---------- Main Page ---------- */

export default function ReportesPage() {
  const [selectedReport, setSelectedReport] = useState<ReportType | null>(null);
  const [period, setPeriod] = useState<Period>("month");

  const selected = REPORT_CARDS.find((r) => r.key === selectedReport);

  return (
    <PermissionGate
      permission="reports:read"
      fallback={
        <EmptyState
          icon={BarChart3}
          title="Acceso restringido"
          description="No tienes permisos para ver reportes."
        />
      }
    >
      <div className="flex flex-col gap-6">
        {!selected ? (
          <>
            {/* Header */}
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Reportes</h1>
              <p className="text-muted-foreground text-sm">
                Genera y consulta reportes financieros, fiscales y operativos.
              </p>
            </div>

            {/* Gallery Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {REPORT_CARDS.map((report) => {
                const Icon = report.icon;
                return (
                  <Card
                    key={report.key}
                    className="cursor-pointer hover:border-primary/50 transition-colors"
                    onClick={() => setSelectedReport(report.key)}
                  >
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Icon className="size-5 text-muted-foreground" />
                        {report.title}
                      </CardTitle>
                      <CardDescription>{report.description}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="h-24 rounded-md bg-muted/50 flex items-center justify-center">
                        <span className="text-xs text-muted-foreground uppercase tracking-wider">
                          {report.chartType === "area"
                            ? "Grafico de Area"
                            : report.chartType === "bar"
                            ? "Grafico de Barras"
                            : report.chartType === "pie"
                            ? "Grafico Circular"
                            : "Tabla de Datos"}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
        ) : (
          <ReportDetail
            report={selected}
            period={period}
            setPeriod={setPeriod}
            onBack={() => setSelectedReport(null)}
          />
        )}
      </div>
    </PermissionGate>
  );
}
