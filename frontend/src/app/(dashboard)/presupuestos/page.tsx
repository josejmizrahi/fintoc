"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import {
  Plus,
  Loader2,
  AlertTriangle,
  Wallet,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
  Dialog,
  DialogContent,
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
import { Separator } from "@/components/ui/separator";

import type { Budget } from "@/types";

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

/* ---------- NewBudgetDialog ---------- */

interface NewBudgetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

function NewBudgetDialog({ open, onOpenChange, onSuccess }: NewBudgetDialogProps) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [amountBudgeted, setAmountBudgeted] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function resetForm() {
    setName("");
    setCategory("");
    setPeriodStart("");
    setPeriodEnd("");
    setAmountBudgeted("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !category || !periodStart || !periodEnd || !amountBudgeted) {
      toast.error("Completa todos los campos requeridos");
      return;
    }
    setSubmitting(true);
    try {
      await api.budgets.create({
        name,
        category,
        period_start: periodStart,
        period_end: periodEnd,
        amount_budgeted: parseFloat(amountBudgeted),
      });
      toast.success("Presupuesto creado exitosamente");
      resetForm();
      onOpenChange(false);
      onSuccess();
    } catch (err: any) {
      toast.error(err.message || "Error al crear el presupuesto");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo Presupuesto</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="budget_name">Nombre</Label>
            <Input
              id="budget_name"
              placeholder="Nombre del presupuesto"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="budget_category">Categoria</Label>
            <Select value={category} onValueChange={setCategory}>
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
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="period_start">Inicio del periodo</Label>
              <Input
                id="period_start"
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="period_end">Fin del periodo</Label>
              <Input
                id="period_end"
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="amount_budgeted">Monto Presupuestado (MXN)</Label>
            <Input
              id="amount_budgeted"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={amountBudgeted}
              onChange={(e) => setAmountBudgeted(e.target.value)}
            />
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Crear Presupuesto
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- ProgressBar ---------- */

function ProgressBar({
  percentage,
  isOverBudget,
}: {
  percentage: number;
  isOverBudget: boolean;
}) {
  const clampedWidth = Math.min(percentage, 100);
  return (
    <div className="h-2 w-full rounded-full bg-muted">
      <div
        className={`h-full rounded-full transition-all ${
          isOverBudget ? "bg-red-600" : "bg-primary"
        }`}
        style={{ width: `${clampedWidth}%` }}
      />
    </div>
  );
}

/* ---------- BudgetVsActual type ---------- */

interface BudgetVsActual {
  id?: number;
  name: string;
  category?: string;
  amount_budgeted: number;
  amount_spent: number;
  difference: number;
  utilization_pct: number;
}

/* ---------- Main Page ---------- */

export default function PresupuestosPage() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [vsActual, setVsActual] = useState<BudgetVsActual[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  async function fetchData() {
    setLoading(true);
    try {
      const [budgetsList, vsActualData] = await Promise.all([
        api.budgets.list(),
        api.budgets.vsActual(),
      ]);
      setBudgets(budgetsList);
      setVsActual(vsActualData);
    } catch (err: any) {
      toast.error(err.message || "Error al cargar presupuestos");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  return (
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

      {/* Budget Cards Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : budgets.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <p className="text-center text-sm text-muted-foreground">
              No hay presupuestos registrados.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {budgets.map((budget) => (
            <Card key={budget.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{budget.name}</CardTitle>
                  {budget.is_over_budget && (
                    <Badge variant="destructive" className="flex items-center gap-1">
                      <AlertTriangle className="size-3" />
                      Sobre presupuesto
                    </Badge>
                  )}
                </div>
                <CardDescription className="capitalize">
                  {budget.category || "Sin categoria"} &middot;{" "}
                  {formatDate(budget.period_start)} - {formatDate(budget.period_end)}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Progress bar */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Utilizacion</span>
                    <span
                      className={`font-medium ${
                        budget.is_over_budget ? "text-red-600" : ""
                      }`}
                    >
                      {budget.utilization_pct.toFixed(1)}%
                    </span>
                  </div>
                  <ProgressBar
                    percentage={budget.utilization_pct}
                    isOverBudget={budget.is_over_budget}
                  />
                </div>

                {/* Amounts */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">Presupuestado</p>
                    <p className="font-mono font-medium">
                      {formatMXN(budget.amount_budgeted)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Gastado</p>
                    <p className="font-mono font-medium">
                      {formatMXN(budget.amount_spent)}
                    </p>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-1.5">
                  <Wallet className="size-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">Disponible:</span>
                </div>
                <span
                  className={`font-mono font-medium ${
                    budget.available < 0 ? "text-red-600" : "text-green-600"
                  }`}
                >
                  {formatMXN(budget.available)}
                </span>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      <Separator />

      {/* Budget vs Actual */}
      <Card>
        <CardHeader>
          <CardTitle>Presupuesto vs Real</CardTitle>
          <CardDescription>
            Comparacion entre montos presupuestados y gastos reales.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : vsActual.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No hay datos de comparacion disponibles.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Presupuesto</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead className="text-right">Presupuestado</TableHead>
                  <TableHead className="text-right">Real</TableHead>
                  <TableHead className="text-right">Diferencia</TableHead>
                  <TableHead className="text-right">Utilizacion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vsActual.map((item, idx) => {
                  const overBudget = item.amount_spent > item.amount_budgeted;
                  return (
                    <TableRow key={item.id ?? idx}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell className="capitalize text-muted-foreground">
                        {item.category || "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatMXN(item.amount_budgeted)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatMXN(item.amount_spent)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono ${
                          overBudget ? "text-red-600" : "text-green-600"
                        }`}
                      >
                        {formatMXN(item.difference)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant={overBudget ? "destructive" : "secondary"}
                        >
                          {item.utilization_pct.toFixed(1)}%
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* New Budget Dialog */}
      <NewBudgetDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={fetchData}
      />
    </div>
  );
}
