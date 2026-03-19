"use client";

import { useState, useMemo } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  Plus,
  Loader2,
  Wallet,
  DollarSign,
  TrendingDown,
  PiggyBank,
  BarChart3,
} from "lucide-react";
import {
  LazyBarChart as BarChart,
  LazyResponsiveContainer as ResponsiveContainer,
  Bar,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable } from "@/components/shared/data-table";
import { KpiCard } from "@/components/shared/kpi-card";
import { EmptyState } from "@/components/shared/empty-state";
import { PermissionGate } from "@/components/shared/permission-gate";

import { api } from "@/lib/api";
import { formatMoney, formatDate } from "@/lib/utils/format";
import type { Budget } from "@/types";

/* ---------- Query keys ---------- */

const budgetKeys = {
  all: ["budgets"] as const,
  list: () => [...budgetKeys.all, "list"] as const,
  vsActual: () => [...budgetKeys.all, "vs-actual"] as const,
};

/* ---------- Zod schema ---------- */

const newBudgetSchema = z
  .object({
    category: z.string().min(1, "Selecciona una categoria"),
    period_start: z.string().min(1, "Fecha de inicio requerida"),
    period_end: z.string().min(1, "Fecha de fin requerida"),
    amount: z.number().positive("El monto debe ser mayor a 0"),
  })
  .refine((data) => data.period_start < data.period_end, {
    message: "La fecha de inicio debe ser anterior a la fecha de fin",
    path: ["period_end"],
  });

type NewBudgetForm = z.infer<typeof newBudgetSchema>;

/* ---------- Chart Tooltip ---------- */

interface ChartTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}

function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
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

/* ---------- Progress color ---------- */

function getProgressColor(pct: number): string {
  if (pct > 95) return "bg-red-600";
  if (pct >= 80) return "bg-yellow-500";
  return "bg-green-600";
}

/* ---------- Budget Columns ---------- */

const budgetColumns: ColumnDef<Budget, unknown>[] = [
  {
    accessorKey: "category",
    header: "Categoria",
    cell: ({ getValue }) => (
      <span className="capitalize font-medium">{getValue<string>() || "-"}</span>
    ),
  },
  {
    id: "period",
    header: "Periodo",
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">
        {formatDate(row.original.period_start)} -{" "}
        {formatDate(row.original.period_end)}
      </span>
    ),
  },
  {
    accessorKey: "amount_budgeted",
    header: () => <span className="text-right block">Presupuestado</span>,
    cell: ({ getValue }) => (
      <span className="text-right font-mono block">
        {formatMoney(getValue<number>())}
      </span>
    ),
  },
  {
    accessorKey: "amount_spent",
    header: () => <span className="text-right block">Gastado</span>,
    cell: ({ getValue }) => (
      <span className="text-right font-mono block">
        {formatMoney(getValue<number>())}
      </span>
    ),
  },
  {
    accessorKey: "amount_committed",
    header: () => <span className="text-right block">Comprometido</span>,
    cell: ({ getValue }) => (
      <span className="text-right font-mono block">
        {formatMoney(getValue<number>())}
      </span>
    ),
  },
  {
    accessorKey: "available",
    header: () => <span className="text-right block">Disponible</span>,
    cell: ({ getValue }) => {
      const val = getValue<number>();
      return (
        <span
          className={`text-right font-mono block ${
            val < 0 ? "text-red-600" : "text-green-600"
          }`}
        >
          {formatMoney(val)}
        </span>
      );
    },
  },
  {
    accessorKey: "utilization_pct",
    header: "% Uso",
    cell: ({ getValue }) => {
      const pct = getValue<number>();
      const colorClass = getProgressColor(pct);
      return (
        <div className="flex items-center gap-2 min-w-[120px]">
          <div className="h-2 w-full rounded-full bg-muted flex-1">
            <div
              className={`h-full rounded-full transition-all ${colorClass}`}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
          <span className="text-xs font-medium w-12 text-right">
            {pct.toFixed(1)}%
          </span>
        </div>
      );
    },
  },
];

/* ---------- NewBudgetDialog ---------- */

function NewBudgetDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();

  const createBudget = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.budgets.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: budgetKeys.all });
      toast.success("Presupuesto creado exitosamente");
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Error al crear presupuesto");
    },
  });

  const form = useForm<NewBudgetForm>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(newBudgetSchema) as any,
    defaultValues: {
      category: "",
      period_start: "",
      period_end: "",
      amount: 0,
    },
  });

  function onSubmit(data: NewBudgetForm) {
    createBudget.mutate({
      name: data.category,
      category: data.category,
      period_start: data.period_start,
      period_end: data.period_end,
      amount_budgeted: data.amount,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo Presupuesto</DialogTitle>
          <DialogDescription>
            Define un presupuesto por categoria y periodo.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="budget-category">Categoria *</Label>
            <Controller
              control={form.control}
              name="category"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar categoria" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="operaciones">Operaciones</SelectItem>
                    <SelectItem value="marketing">Marketing</SelectItem>
                    <SelectItem value="tecnologia">Tecnologia</SelectItem>
                    <SelectItem value="personal">Personal</SelectItem>
                    <SelectItem value="viaticos">Viaticos</SelectItem>
                    <SelectItem value="materiales">Materiales</SelectItem>
                    <SelectItem value="servicios">Servicios</SelectItem>
                    <SelectItem value="otros">Otros</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
            {form.formState.errors.category && (
              <p className="text-xs text-destructive">
                {form.formState.errors.category.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="period-start">Periodo inicio *</Label>
              <Input
                id="period-start"
                type="date"
                {...form.register("period_start")}
              />
              {form.formState.errors.period_start && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.period_start.message}
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="period-end">Periodo fin *</Label>
              <Input
                id="period-end"
                type="date"
                {...form.register("period_end")}
              />
              {form.formState.errors.period_end && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.period_end.message}
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="budget-amount">Monto (MXN) *</Label>
            <Input
              id="budget-amount"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              {...form.register("amount", { valueAsNumber: true })}
            />
            {form.formState.errors.amount && (
              <p className="text-xs text-destructive">
                {form.formState.errors.amount.message}
              </p>
            )}
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createBudget.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={createBudget.isPending}>
              {createBudget.isPending && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Crear Presupuesto
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Main Page ---------- */

export default function PresupuestosPage() {
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: budgetsData, isLoading: budgetsLoading } = useQuery({
    queryKey: budgetKeys.list(),
    queryFn: () => api.budgets.list(),
    staleTime: 30_000,
  });

  const { data: vsActualData, isLoading: vsActualLoading } = useQuery({
    queryKey: budgetKeys.vsActual(),
    queryFn: () => api.budgets.vsActual(),
    staleTime: 30_000,
  });

  const budgets: Budget[] = useMemo(
    () => (Array.isArray(budgetsData) ? budgetsData : []),
    [budgetsData]
  );

  const vsActual = useMemo(
    () => (Array.isArray(vsActualData) ? vsActualData : []),
    [vsActualData]
  );

  /* KPI aggregates */
  const totalBudgeted = budgets.reduce((s, b) => s + b.amount_budgeted, 0);
  const totalSpent = budgets.reduce((s, b) => s + b.amount_spent, 0);
  const totalCommitted = budgets.reduce((s, b) => s + b.amount_committed, 0);
  const totalAvailable = budgets.reduce((s, b) => s + b.available, 0);

  /* Chart data */
  const chartData = useMemo(
    () =>
      vsActual.map((item: Record<string, unknown>) => ({
        name: item.category || item.name || "-",
        Presupuestado: item.amount_budgeted ?? item.budgeted ?? 0,
        Real: item.amount_spent ?? item.actual ?? 0,
      })),
    [vsActual]
  );

  return (
    <PermissionGate
      permission="budgets.read"
      fallback={
        <EmptyState
          icon={Wallet}
          title="Acceso restringido"
          description="No tienes permisos para ver presupuestos."
        />
      }
    >
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Presupuestos</h1>
            <p className="text-muted-foreground text-sm">
              Control y seguimiento de presupuestos por categoria y periodo.
            </p>
          </div>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 size-4" />
            Nuevo Presupuesto
          </Button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <KpiCard
            title="Presupuesto Total"
            value={budgetsLoading ? "..." : formatMoney(totalBudgeted)}
            icon={PiggyBank}
            description="Monto total asignado"
          />
          <KpiCard
            title="Gastado"
            value={budgetsLoading ? "..." : formatMoney(totalSpent)}
            icon={TrendingDown}
            trend="down"
            description="Gasto acumulado"
            destructive
          />
          <KpiCard
            title="Comprometido"
            value={budgetsLoading ? "..." : formatMoney(totalCommitted)}
            icon={DollarSign}
            description="Compromisos pendientes"
          />
          <KpiCard
            title="Disponible"
            value={budgetsLoading ? "..." : formatMoney(totalAvailable)}
            icon={Wallet}
            trend={totalAvailable >= 0 ? "up" : "down"}
            description="Saldo disponible"
          />
        </div>

        {/* DataTable */}
        <Card>
          <CardHeader>
            <CardTitle>Detalle por Presupuesto</CardTitle>
            <CardDescription>
              Desglose por categoria con porcentaje de utilizacion.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={budgetColumns}
              data={budgets}
              isLoading={budgetsLoading}
              emptyState={
                <EmptyState
                  icon={Wallet}
                  title="Sin presupuestos"
                  description="No hay presupuestos registrados."
                  action={{
                    label: "Crear primer presupuesto",
                    onClick: () => setDialogOpen(true),
                  }}
                />
              }
            />
          </CardContent>
        </Card>

        {/* BarChart: Budget vs Actual */}
        <Card>
          <CardHeader>
            <CardTitle>Presupuesto vs Real</CardTitle>
            <CardDescription>
              Comparacion visual por categoria entre montos presupuestados y
              gastados.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {vsActualLoading ? (
              <div className="h-[350px] flex items-center justify-center">
                <span className="text-sm text-muted-foreground">
                  Cargando datos...
                </span>
              </div>
            ) : chartData.length === 0 ? (
              <EmptyState
                icon={BarChart3}
                title="Sin datos"
                description="No hay datos de comparacion disponibles."
              />
            ) : (
              <div className="h-[350px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartData}
                    margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-muted"
                    />
                    <XAxis
                      dataKey="name"
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
                    <Tooltip content={<ChartTooltip />} />
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
            )}
          </CardContent>
        </Card>

        {/* New Budget Dialog */}
        <NewBudgetDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      </div>
    </PermissionGate>
  );
}
