"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Activity,
  Loader2,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

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
import { Separator } from "@/components/ui/separator";

import type { TreasurySnapshot, CashFlowForecast } from "@/types";

/* ---------- helpers ---------- */

function formatMXN(amount: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(amount);
}

function formatDate(dateStr?: string) {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatShortDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
  });
}

/* ---------- Movement type ---------- */

interface Movement {
  id?: number;
  date?: string;
  description?: string;
  amount: number;
  type: "inbound" | "outbound";
}

/* ---------- Main Page ---------- */

export default function TesoreriaPage() {
  const [snapshot, setSnapshot] = useState<TreasurySnapshot | null>(null);
  const [forecast, setForecast] = useState<CashFlowForecast[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchData() {
    setLoading(true);
    try {
      const [snapshotData, forecastData, movementsData] = await Promise.all([
        api.treasury.snapshot(),
        api.treasury.forecast(),
        api.treasury.movements(),
      ]);
      setSnapshot(snapshotData);
      setForecast(forecastData);
      setMovements(movementsData);
    } catch (err: any) {
      toast.error(err.message || "Error al cargar datos de tesoreria");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  /* ---------- KPI cards ---------- */

  const kpiCards = [
    {
      title: "Saldo Total",
      value: snapshot ? formatMXN(snapshot.total_balance) : "-",
      icon: DollarSign,
      description: "Balance consolidado",
    },
    {
      title: "Entradas Hoy",
      value: snapshot ? formatMXN(snapshot.inflows_today) : "-",
      icon: TrendingUp,
      description: "Ingresos del dia",
      positive: true,
    },
    {
      title: "Salidas Hoy",
      value: snapshot ? formatMXN(snapshot.outflows_today) : "-",
      icon: TrendingDown,
      description: "Egresos del dia",
      positive: false,
    },
    {
      title: "Posicion Neta",
      value: snapshot ? formatMXN(snapshot.net_position) : "-",
      icon: Activity,
      description: "Diferencia neta",
    },
  ];

  const periodCards = [
    {
      title: "Entradas / Salidas Semana",
      inflows: snapshot?.inflows_week ?? 0,
      outflows: snapshot?.outflows_week ?? 0,
    },
    {
      title: "Entradas / Salidas Mes",
      inflows: snapshot?.inflows_month ?? 0,
      outflows: snapshot?.outflows_month ?? 0,
    },
  ];

  /* ---------- Chart tooltip ---------- */

  function ChartTooltipContent({ active, payload, label }: any) {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-lg border bg-background p-3 shadow-md">
        <p className="mb-1 text-sm font-medium">{label}</p>
        {payload.map((entry: any) => (
          <p key={entry.name} className="text-xs" style={{ color: entry.color }}>
            {entry.name}: {formatMXN(entry.value)}
          </p>
        ))}
      </div>
    );
  }

  /* ---------- render ---------- */

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tesoreria</h1>
          <p className="text-muted-foreground text-sm">
            Posicion de efectivo, flujos y movimientos.
          </p>
        </div>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  const chartData = forecast.map((f) => ({
    ...f,
    date: formatShortDate(f.date),
  }));

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tesoreria</h1>
        <p className="text-muted-foreground text-sm">
          Posicion de efectivo, flujos y movimientos.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpiCards.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.title}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{kpi.title}</CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{kpi.value}</div>
                <p className="text-xs text-muted-foreground">{kpi.description}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Period Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {periodCards.map((card) => (
          <Card key={card.title}>
            <CardHeader>
              <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ArrowUpRight className="h-4 w-4 text-green-600" />
                  <div>
                    <p className="text-xs text-muted-foreground">Entradas</p>
                    <p className="text-lg font-bold text-green-600">
                      {formatMXN(card.inflows)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <ArrowDownRight className="h-4 w-4 text-red-600" />
                  <div>
                    <p className="text-xs text-muted-foreground">Salidas</p>
                    <p className="text-lg font-bold text-red-600">
                      {formatMXN(card.outflows)}
                    </p>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Neto</p>
                  <p
                    className={`text-lg font-bold ${
                      card.inflows - card.outflows >= 0
                        ? "text-green-600"
                        : "text-red-600"
                    }`}
                  >
                    {formatMXN(card.inflows - card.outflows)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Separator />

      {/* Cash Flow Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Flujo de Efectivo Proyectado</CardTitle>
          <CardDescription>
            Proyeccion de entradas, salidas y balance para los proximos dias.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No hay datos de proyeccion disponibles.
            </p>
          ) : (
            <div className="h-[350px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={chartData}
                  margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="colorInflows" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#16a34a" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorOutflows" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#dc2626" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#dc2626" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12 }}
                    className="text-muted-foreground"
                  />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) =>
                      new Intl.NumberFormat("es-MX", {
                        notation: "compact",
                        compactDisplay: "short",
                        style: "currency",
                        currency: "MXN",
                      }).format(value)
                    }
                    className="text-muted-foreground"
                  />
                  <Tooltip content={<ChartTooltipContent />} />
                  <Area
                    type="monotone"
                    dataKey="expected_inflows"
                    name="Entradas Esperadas"
                    stroke="#16a34a"
                    fill="url(#colorInflows)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="expected_outflows"
                    name="Salidas Esperadas"
                    stroke="#dc2626"
                    fill="url(#colorOutflows)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="projected_balance"
                    name="Balance Proyectado"
                    stroke="#2563eb"
                    fill="none"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Movements Table */}
      <Card>
        <CardHeader>
          <CardTitle>Movimientos</CardTitle>
          <CardDescription>
            Movimientos recientes de tesoreria.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {movements.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No hay movimientos registrados.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Descripcion</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead>Tipo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((m, idx) => (
                  <TableRow key={m.id ?? idx}>
                    <TableCell className="text-muted-foreground">
                      {formatDate(m.date)}
                    </TableCell>
                    <TableCell>{m.description || "-"}</TableCell>
                    <TableCell
                      className={`text-right font-mono ${
                        m.type === "inbound" ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {m.type === "inbound" ? "+" : "-"}
                      {formatMXN(Math.abs(m.amount))}
                    </TableCell>
                    <TableCell>
                      {m.type === "inbound" ? (
                        <Badge
                          variant="default"
                          className="bg-green-600 hover:bg-green-700 text-white"
                        >
                          Entrada
                        </Badge>
                      ) : (
                        <Badge variant="destructive">Salida</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
