"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp,
  Clock,
  ShieldCheck,
  BarChart3,
  Users,
  UserCheck,
  FileSpreadsheet,
  FileText,
  Loader2,
} from "lucide-react";
import {
  LazyAreaChart as AreaChart,
  LazyBarChart as BarChart,
  LazyPieChart as PieChart,
  LazyResponsiveContainer as ResponsiveContainer,
  Area,
  Bar,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "@/components/shared/lazy-charts";

import { Button } from "@/components/ui/button";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

import { EmptyState } from "@/components/shared/empty-state";
import { PermissionGate } from "@/components/shared/permission-gate";

import { api } from "@/lib/api";
import { formatMoney } from "@/lib/utils/format";
import { toast } from "sonner";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

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
  chartType: "area" | "bar" | "pie" | "grouped-bar" | "table";
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
    chartType: "grouped-bar",
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

const CHART_TYPE_LABELS: Record<string, string> = {
  area: "Grafico de Area",
  bar: "Grafico de Barras",
  pie: "Grafico Circular",
  "grouped-bar": "Barras Agrupadas",
  table: "Tabla de Datos",
};

/* ------------------------------------------------------------------ */
/* Query hook for any report                                           */
/* ------------------------------------------------------------------ */

function useReportQuery(key: ReportType | null, period: Period) {
  return useQuery({
    queryKey: ["report", key, period],
    queryFn: async () => {
      if (!key) return null;
      switch (key) {
        case "cash-flow":
          return api.reports.cashFlow({ period });
        case "aging":
          return api.reports.aging({ period });
        case "sat-compliance":
          return api.reports.satCompliance({ period });
        case "budget-vs-actual":
          return api.reports.budgetVsActual();
        case "vendor-summary":
          return api.reports.vendorSummary();
        case "customer-summary":
          return api.reports.customerSummary();
        default:
          return null;
      }
    },
    enabled: !!key,
    staleTime: 60_000,
  });
}

/* ------------------------------------------------------------------ */
/* Chart tooltip                                                       */
/* ------------------------------------------------------------------ */

interface ChartTooltipContentProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}

function ChartTooltipContent({ active, payload, label }: ChartTooltipContentProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md">
      <p className="mb-1 text-sm font-medium">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="text-xs" style={{ color: entry.color }}>
          {entry.name}: {formatMoney(entry.value)}
        </p>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Currency axis formatter                                             */
/* ------------------------------------------------------------------ */

function formatAxis(value: number) {
  return new Intl.NumberFormat("es-MX", {
    notation: "compact",
    style: "currency",
    currency: "MXN",
  }).format(value);
}

/* ------------------------------------------------------------------ */
/* Report Detail Dialog                                                */
/* ------------------------------------------------------------------ */

function ReportDetailDialog({
  report,
  open,
  onOpenChange,
}: {
  report: ReportCardDef | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [period, setPeriod] = useState<Period>("month");
  const { data, isLoading } = useReportQuery(report?.key ?? null, period);
  const [exporting, setExporting] = useState<"pdf" | "excel" | null>(null);

  const handleExport = useCallback(
    async (format: "pdf" | "excel") => {
      if (!report) return;
      setExporting(format);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let result: any;
        switch (report.key) {
          case "cash-flow":
            result = await api.reports.cashFlow({ period, format });
            break;
          case "aging":
            result = await api.reports.aging({ period, format });
            break;
          case "sat-compliance":
            result = await api.reports.satCompliance({ period, format });
            break;
          case "budget-vs-actual":
            result = await api.reports.budgetVsActual();
            break;
          case "vendor-summary":
            result = await api.reports.vendorSummary();
            break;
          case "customer-summary":
            result = await api.reports.customerSummary();
            break;
        }

        if (result?.url) {
          window.open(result.url, "_blank");
        } else if (result instanceof Blob) {
          const url = URL.createObjectURL(result);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${report.key}-${period}.${format === "pdf" ? "pdf" : "xlsx"}`;
          a.click();
          URL.revokeObjectURL(url);
        }

        toast.success(
          `Exportacion ${format.toUpperCase()} generada exitosamente`,
        );
      } catch (err: unknown) {
        toast.error(
          (err instanceof Error ? err.message : null) || `Error al exportar en formato ${format.toUpperCase()}`,
        );
      } finally {
        setExporting(null);
      }
    },
    [report, period],
  );

  if (!report) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <report.icon className="size-5" />
            {report.title}
          </DialogTitle>
        </DialogHeader>

        {/* Controls row */}
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

          <PermissionGate permission="reports:export">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={exporting === "pdf"}
                onClick={() => handleExport("pdf")}
              >
                {exporting === "pdf" ? (
                  <Loader2 className="size-4 mr-1 animate-spin" />
                ) : (
                  <FileText className="size-4 mr-1" />
                )}
                PDF
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={exporting === "excel"}
                onClick={() => handleExport("excel")}
              >
                {exporting === "excel" ? (
                  <Loader2 className="size-4 mr-1 animate-spin" />
                ) : (
                  <FileSpreadsheet className="size-4 mr-1" />
                )}
                Excel
              </Button>
            </div>
          </PermissionGate>
        </div>

        {/* Loading skeleton */}
        {isLoading && (
          <div className="space-y-4 py-4">
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-[300px] w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        )}

        {/* ---- Cash Flow ---- */}
        {report.key === "cash-flow" && !isLoading && data && (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-4">
              <Card>
                <CardContent className="pt-4">
                  <p className="text-sm text-muted-foreground">
                    Total Ingresos
                  </p>
                  <p className="text-lg font-bold text-green-600">
                    {formatMoney(data.total_inflows ?? data.inflows ?? 0)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <p className="text-sm text-muted-foreground">Total Egresos</p>
                  <p className="text-lg font-bold text-red-600">
                    {formatMoney(data.total_outflows ?? data.outflows ?? 0)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <p className="text-sm text-muted-foreground">Flujo Neto</p>
                  <p className="text-lg font-bold">
                    {formatMoney(data.net_flow ?? data.net ?? 0)}
                  </p>
                </CardContent>
              </Card>
            </div>
            {Array.isArray(data.details || data.entries) && (
              <div className="h-[350px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={data.details || data.entries}
                    margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-muted"
                    />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={formatAxis} />
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
            {Array.isArray(data.details || data.entries) && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead className="text-right">Ingresos</TableHead>
                    <TableHead className="text-right">Egresos</TableHead>
                    <TableHead className="text-right">Neto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data.details || data.entries).map(
                    (row: Record<string, unknown>, idx: number) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">
                          {(row.date as string) || "-"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-green-600">
                          {formatMoney((row.inflows as number) ?? 0)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-red-600">
                          {formatMoney((row.outflows as number) ?? 0)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatMoney(
                            ((row.inflows as number) ?? 0) - ((row.outflows as number) ?? 0),
                          )}
                        </TableCell>
                      </TableRow>
                    ),
                  )}
                </TableBody>
              </Table>
            )}
          </div>
        )}

        {/* ---- Aging ---- */}
        {report.key === "aging" && !isLoading && data && (
          <div className="space-y-6">
            {Array.isArray(data.buckets || data) && (
              <>
                <div className="h-[350px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.buckets || data}
                      margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        className="stroke-muted"
                      />
                      <XAxis dataKey="range" tick={{ fontSize: 12 }} />
                      <YAxis
                        tick={{ fontSize: 12 }}
                        tickFormatter={formatAxis}
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
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rango</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                      <TableHead className="text-right">Facturas</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data.buckets || data).map((b: Record<string, unknown>, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">
                          {(b.range as string) || (b.bucket as string) || (b.label as string) || "-"}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatMoney((b.amount as number) ?? (b.total as number) ?? 0)}
                        </TableCell>
                        <TableCell className="text-right">
                          {(b.count as number) ?? (b.invoices as number) ?? "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </div>
        )}

        {/* ---- SAT Compliance ---- */}
        {report.key === "sat-compliance" && !isLoading && data && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-4">
                  <p className="text-sm text-muted-foreground">
                    Total Documentos
                  </p>
                  <p className="text-lg font-bold">
                    {data.total_documents ?? data.total ?? "-"}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <p className="text-sm text-muted-foreground">Vigentes</p>
                  <p className="text-lg font-bold text-green-600">
                    {data.valid ?? data.vigentes ?? "-"}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <p className="text-sm text-muted-foreground">Cancelados</p>
                  <p className="text-lg font-bold text-red-600">
                    {data.cancelled ?? data.cancelados ?? "-"}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <p className="text-sm text-muted-foreground">
                    Tasa Cumplimiento
                  </p>
                  <p className="text-lg font-bold">
                    {data.compliance_rate != null
                      ? `${data.compliance_rate.toFixed(1)}%`
                      : data.compliance_pct != null
                        ? `${data.compliance_pct.toFixed(1)}%`
                        : "-"}
                  </p>
                </CardContent>
              </Card>
            </div>
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
                    label={(props: { name?: string; percent?: number }) =>
                      `${props.name ?? ''} (${((props.percent ?? 0) * 100).toFixed(0)}%)`
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
          </div>
        )}

        {/* ---- Budget vs Actual ---- */}
        {report.key === "budget-vs-actual" &&
          !isLoading &&
          Array.isArray(data) && (
            <div className="space-y-6">
              <div className="h-[350px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data.map((item: Record<string, unknown>) => ({
                      name: (item.category as string) || (item.name as string) || "-",
                      Presupuestado:
                        (item.amount_budgeted as number) ?? (item.budgeted as number) ?? 0,
                      Real: (item.amount_spent as number) ?? (item.actual as number) ?? 0,
                    }))}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-muted"
                    />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis
                      tick={{ fontSize: 12 }}
                      tickFormatter={formatAxis}
                    />
                    <Tooltip content={<ChartTooltipContent />} />
                    <Legend />
                    <Bar
                      dataKey="Presupuestado"
                      fill="#2563eb"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="Real"
                      fill="#dc2626"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Categoria</TableHead>
                    <TableHead className="text-right">Presupuestado</TableHead>
                    <TableHead className="text-right">Actual</TableHead>
                    <TableHead className="text-right">Variacion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((item: Record<string, unknown>, idx: number) => {
                    const budgeted =
                      (item.amount_budgeted as number) ?? (item.budgeted as number) ?? 0;
                    const spent = (item.amount_spent as number) ?? (item.actual as number) ?? 0;
                    const variance = budgeted - spent;
                    return (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">
                          {(item.name as string) || (item.category as string) || "-"}
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
            </div>
          )}

        {/* ---- Vendor Summary ---- */}
        {report.key === "vendor-summary" &&
          !isLoading &&
          Array.isArray(data) && (
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
                {data.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center text-muted-foreground py-8"
                    >
                      No hay datos de proveedores disponibles.
                    </TableCell>
                  </TableRow>
                )}
                {data.map((v: Record<string, unknown>, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell className="font-medium">
                      {(v.name as string) || (v.vendor_name as string) || "-"}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {(v.rfc as string) || (v.vat as string) || "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatMoney((v.total_paid as number) ?? (v.paid as number) ?? 0)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatMoney((v.total_pending as number) ?? (v.pending as number) ?? 0)}
                    </TableCell>
                    <TableCell className="text-right">
                      {(v.invoice_count as number) ?? (v.bills as number) ?? "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

        {/* ---- Customer Summary ---- */}
        {report.key === "customer-summary" &&
          !isLoading &&
          Array.isArray(data) && (
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
                {data.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center text-muted-foreground py-8"
                    >
                      No hay datos de clientes disponibles.
                    </TableCell>
                  </TableRow>
                )}
                {data.map((c: Record<string, unknown>, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell className="font-medium">
                      {(c.name as string) || (c.customer_name as string) || "-"}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {(c.rfc as string) || (c.vat as string) || "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatMoney((c.total_collected as number) ?? (c.collected as number) ?? 0)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatMoney((c.total_pending as number) ?? (c.pending as number) ?? 0)}
                    </TableCell>
                    <TableCell className="text-right">
                      {(c.invoice_count as number) ?? (c.invoices as number) ?? "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

        {/* No data fallback */}
        {!isLoading && !data && (
          <EmptyState
            icon={BarChart3}
            title="Sin datos"
            description="No hay datos disponibles para este reporte en el periodo seleccionado."
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ================================================================== */
/* Main Page                                                           */
/* ================================================================== */

export default function ReportesPage() {
  const [selectedReport, setSelectedReport] = useState<ReportType | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const selectedDef = useMemo(
    () => REPORT_CARDS.find((r) => r.key === selectedReport) ?? null,
    [selectedReport],
  );

  function handleCardClick(key: ReportType) {
    setSelectedReport(key);
    setDialogOpen(true);
  }

  function handleDialogClose(open: boolean) {
    setDialogOpen(open);
    if (!open) setSelectedReport(null);
  }

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
                className="cursor-pointer hover:border-primary/50 hover:shadow-md transition-all"
                onClick={() => handleCardClick(report.key)}
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
                      {CHART_TYPE_LABELS[report.chartType] ?? report.chartType}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Detail Dialog */}
        <ReportDetailDialog
          report={selectedDef}
          open={dialogOpen}
          onOpenChange={handleDialogClose}
        />
      </div>
    </PermissionGate>
  );
}
