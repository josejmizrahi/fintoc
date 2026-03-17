"use client";

import { useMemo } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Activity,
  Landmark,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  LazyLineChart as LineChart,
  LazyResponsiveContainer as ResponsiveContainer,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Legend,
} from "@/components/shared/lazy-charts";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import { DataTable } from "@/components/shared/data-table";
import { KpiCard } from "@/components/shared/kpi-card";
import { EmptyState } from "@/components/shared/empty-state";
import { PermissionGate } from "@/components/shared/permission-gate";
import { SearchInput } from "@/components/shared/search-input";
import {
  useTreasurySnapshot,
  useTreasuryForecast,
  useTreasuryMovements,
} from "@/lib/hooks/use-treasury";
import { useTreasuryFilters } from "@/lib/hooks/use-url-state";
import { formatMoney, formatDate, formatCLABE } from "@/lib/utils/format";

/* ---------- Movement type ---------- */

interface Movement {
  id: string;
  date: string;
  description: string;
  amount: number;
  balance: number;
  type: "inbound" | "outbound" | "credit" | "debit";
  reconciled: boolean;
}

interface BankAccount {
  id: string;
  bank: string;
  clabe: string;
  balance: number;
  currency: string;
}

/* ---------- Forecast Chart Tooltip ---------- */

interface ForecastTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}

function ForecastTooltip({ active, payload, label }: ForecastTooltipProps) {
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

/* ---------- Columns ---------- */

const movementColumns: ColumnDef<Movement, unknown>[] = [
  {
    accessorKey: "date",
    header: "Fecha",
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">{formatDate(getValue() as string)}</span>
    ),
  },
  {
    accessorKey: "description",
    header: "Descripcion",
    cell: ({ getValue }) => (
      <span className="max-w-[250px] truncate block">
        {getValue<string>() || "-"}
      </span>
    ),
  },
  {
    accessorKey: "amount",
    header: () => <span className="text-right block">Monto</span>,
    cell: ({ row }) => {
      const amount = row.original.amount;
      const t = row.original.type;
      const isPositive = t === "inbound" || t === "credit";
      return (
        <span
          className={`text-right font-mono block ${
            isPositive ? "text-green-600" : "text-red-600"
          }`}
        >
          {isPositive ? "+" : "-"}
          {formatMoney(Math.abs(amount))}
        </span>
      );
    },
  },
  {
    accessorKey: "balance",
    header: () => <span className="text-right block">Saldo</span>,
    cell: ({ getValue }) => (
      <span className="text-right font-mono block">
        {formatMoney(getValue<number>())}
      </span>
    ),
  },
  {
    accessorKey: "type",
    header: "Tipo",
    cell: ({ getValue }) => {
      const type = getValue<string>();
      const isIn = type === "inbound" || type === "credit";
      return isIn ? (
        <Badge className="bg-green-600 hover:bg-green-700 text-white">
          Entrada
        </Badge>
      ) : (
        <Badge variant="destructive">Salida</Badge>
      );
    },
  },
  {
    accessorKey: "reconciled",
    header: "Conciliado?",
    cell: ({ getValue }) =>
      getValue<boolean>() ? (
        <CheckCircle2 className="size-4 text-green-600 mx-auto" />
      ) : (
        <XCircle className="size-4 text-muted-foreground mx-auto" />
      ),
  },
];

/* ---------- Main Page ---------- */

export default function TesoreriaPage() {
  const [filters, setFilters] = useTreasuryFilters();

  const { data: snapshot, isLoading: snapshotLoading } = useTreasurySnapshot();
  const { data: forecast, isLoading: forecastLoading } =
    useTreasuryForecast(30);
  const { data: movements, isLoading: movementsLoading } =
    useTreasuryMovements({
      type: filters.type || undefined,
      page: filters.page,
      per_page: filters.per_page,
      date_from: filters.date_from || undefined,
      date_to: filters.date_to || undefined,
    });

  const chartData = useMemo(() => {
    if (!forecast) return [];
    const items = Array.isArray(forecast) ? forecast : forecast.data ?? [];
    return items.map((f: Record<string, unknown>) => ({
      date: new Date(f.date as string).toLocaleDateString("es-MX", {
        day: "2-digit",
        month: "short",
      }),
      optimista: (f.optimistic as number) ?? 0,
      base: (f.base as number) ?? 0,
      pesimista: (f.pessimistic as number) ?? 0,
    }));
  }, [forecast]);

  const movementsList: Movement[] = useMemo(() => {
    if (!movements) return [];
    return Array.isArray(movements) ? movements : (movements as Record<string, unknown>).data as Movement[] ?? [];
  }, [movements]);

  const accounts: BankAccount[] = useMemo(() => {
    if (!snapshot) return [];
    return (snapshot as Record<string, unknown>).accounts as BankAccount[] ?? [];
  }, [snapshot]);

  const totalMovements = Array.isArray(movements)
    ? movements.length
    : (movements as Record<string, unknown>)?.meta
      ? ((movements as Record<string, unknown>).meta as Record<string, number>)?.total ?? movementsList.length
      : (movements as Record<string, unknown>)?.total as number ?? movementsList.length;

  return (
    <PermissionGate
      permission="treasury:read"
      fallback={
        <EmptyState
          icon={Landmark}
          title="Acceso restringido"
          description="No tienes permisos para ver la tesoreria."
        />
      }
    >
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tesoreria</h1>
          <p className="text-muted-foreground text-sm">
            Posicion de efectivo, flujos y movimientos bancarios.
          </p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <KpiCard
            title="Saldo Actual"
            value={
              snapshotLoading
                ? "..."
                : formatMoney(snapshot?.total_balance ?? 0)
            }
            icon={DollarSign}
            description="Balance consolidado"
          />
          <KpiCard
            title="Ingresos del Mes"
            value={
              snapshotLoading
                ? "..."
                : formatMoney(snapshot?.inflows_month ?? 0)
            }
            icon={TrendingUp}
            trend="up"
            description="Entradas acumuladas"
          />
          <KpiCard
            title="Egresos del Mes"
            value={
              snapshotLoading
                ? "..."
                : formatMoney(snapshot?.outflows_month ?? 0)
            }
            icon={TrendingDown}
            trend="down"
            description="Salidas acumuladas"
            destructive
          />
          <KpiCard
            title="Flujo Neto"
            value={
              snapshotLoading
                ? "..."
                : formatMoney(snapshot?.net_position ?? 0)
            }
            icon={Activity}
            description="Ingresos - Egresos"
            trend={(snapshot?.net_position ?? 0) >= 0 ? "up" : "down"}
          />
        </div>

        {/* Forecast Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Proyeccion de Flujo (30 dias)</CardTitle>
            <CardDescription>
              Escenarios optimista, base y pesimista para los proximos 30 dias.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {forecastLoading ? (
              <div className="h-[350px] flex items-center justify-center">
                <span className="text-sm text-muted-foreground">
                  Cargando proyeccion...
                </span>
              </div>
            ) : chartData.length === 0 ? (
              <EmptyState
                icon={TrendingUp}
                title="Sin datos de proyeccion"
                description="No hay datos de forecast disponibles."
              />
            ) : (
              <div className="h-[350px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={chartData}
                    margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-muted"
                    />
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
                    <Tooltip content={<ForecastTooltip />} />
                    <Legend />
                    <ReferenceLine
                      y={0}
                      stroke="#dc2626"
                      strokeWidth={2}
                      strokeDasharray="8 4"
                      label={{
                        value: "$0",
                        position: "right",
                        fill: "#dc2626",
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="optimista"
                      name="Optimista"
                      stroke="#16a34a"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="base"
                      name="Base"
                      stroke="#2563eb"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="pesimista"
                      name="Pesimista"
                      stroke="#dc2626"
                      strokeWidth={2}
                      dot={false}
                      strokeDasharray="5 5"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Bank Movements DataTable */}
        <Card>
          <CardHeader>
            <CardTitle>Movimientos Bancarios</CardTitle>
            <CardDescription>
              Movimientos recientes de tus cuentas bancarias.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={movementColumns}
              data={movementsList}
              isLoading={movementsLoading}
              pagination={{
                page: filters.page,
                pageSize: filters.per_page,
                total: totalMovements,
              }}
              onPaginationChange={(p) =>
                setFilters({ page: p.page, per_page: p.pageSize })
              }
              emptyState={
                <EmptyState
                  icon={Landmark}
                  title="Sin movimientos"
                  description="No hay movimientos bancarios registrados."
                />
              }
              toolbar={
                <SearchInput
                  value={filters.type}
                  onChange={(v) => setFilters({ type: v, page: 1 })}
                  placeholder="Filtrar por tipo..."
                />
              }
            />
          </CardContent>
        </Card>

        {/* Bank Accounts */}
        {accounts.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-4">Cuentas Bancarias</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {accounts.map((account) => (
                <Card key={account.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Landmark className="size-4 text-muted-foreground" />
                      {account.bank || "Banco"}
                    </CardTitle>
                    <CardDescription>
                      CLABE: {formatCLABE(account.clabe)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold font-mono">
                      {formatMoney(account.balance, account.currency || "MXN")}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </PermissionGate>
  );
}
