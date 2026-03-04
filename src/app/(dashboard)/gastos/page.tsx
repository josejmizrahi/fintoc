"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import {
  Plus,
  Loader2,
  MoreHorizontal,
  Send,
  CheckCircle,
  XCircle,
  Banknote,
  Check,
  X,
  DollarSign,
  Clock,
  CreditCard,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";

import type { Expense } from "@/types";

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

type BadgeVariant = "default" | "secondary" | "outline" | "destructive";

const STATUS_BADGE: Record<string, { label: string; variant: BadgeVariant; className?: string }> = {
  draft: { label: "Borrador", variant: "secondary" },
  submitted: { label: "Enviado", variant: "outline" },
  approved: { label: "Aprobado", variant: "default" },
  rejected: { label: "Rechazado", variant: "destructive" },
  paid: { label: "Pagado", variant: "default", className: "bg-green-600 hover:bg-green-700 text-white" },
};

function statusBadge(status: string) {
  const cfg = STATUS_BADGE[status] ?? { label: status, variant: "secondary" as BadgeVariant };
  return (
    <Badge variant={cfg.variant} className={cfg.className}>
      {cfg.label}
    </Badge>
  );
}

/* ---------- NewExpenseDialog ---------- */

interface NewExpenseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

function NewExpenseDialog({ open, onOpenChange, onSuccess }: NewExpenseDialogProps) {
  const [employeeName, setEmployeeName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("MXN");
  const [cfdiUuid, setCfdiUuid] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function resetForm() {
    setEmployeeName("");
    setCategory("");
    setDescription("");
    setAmount("");
    setCurrency("MXN");
    setCfdiUuid("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeName || !category || !amount) {
      toast.error("Completa los campos requeridos");
      return;
    }
    setSubmitting(true);
    try {
      await api.expenses.create({
        employee_name: employeeName,
        category,
        description: description || undefined,
        amount: parseFloat(amount),
        currency,
        cfdi_uuid: cfdiUuid || undefined,
      });
      toast.success("Gasto creado exitosamente");
      resetForm();
      onOpenChange(false);
      onSuccess();
    } catch (err: any) {
      toast.error(err.message || "Error al crear el gasto");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo Gasto</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="employee_name">Empleado</Label>
            <Input
              id="employee_name"
              placeholder="Nombre del empleado"
              value={employeeName}
              onChange={(e) => setEmployeeName(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="category">Categoria</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="viaticos">Viaticos</SelectItem>
                <SelectItem value="materiales">Materiales</SelectItem>
                <SelectItem value="servicios">Servicios</SelectItem>
                <SelectItem value="otros">Otros</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="description">Descripcion</Label>
            <Textarea
              id="description"
              placeholder="Descripcion del gasto"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="amount">Monto</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="currency">Moneda</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MXN">MXN</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="cfdi_uuid">UUID CFDI (opcional)</Label>
            <Input
              id="cfdi_uuid"
              placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
              value={cfdiUuid}
              onChange={(e) => setCfdiUuid(e.target.value)}
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
              Crear Gasto
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Main Page ---------- */

interface ExpenseSummary {
  total_pending: number;
  total_approved: number;
  total_paid: number;
}

export default function GastosPage() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  async function fetchData() {
    setLoading(true);
    try {
      const [expensesList, summaryData] = await Promise.all([
        api.expenses.list(),
        api.expenses.summary(),
      ]);
      setExpenses(expensesList);
      setSummary(summaryData);
    } catch (err: any) {
      toast.error(err.message || "Error al cargar gastos");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  async function handleAction(id: number, action: "submit" | "approve" | "reject" | "pay") {
    setActionLoading(id);
    const labels: Record<string, string> = {
      submit: "Gasto enviado",
      approve: "Gasto aprobado",
      reject: "Gasto rechazado",
      pay: "Gasto pagado",
    };
    try {
      await api.expenses.action(id, { action });
      toast.success(labels[action]);
      fetchData();
    } catch (err: any) {
      toast.error(err.message || "Error al procesar la accion");
    } finally {
      setActionLoading(null);
    }
  }

  const summaryCards = [
    {
      title: "Pendientes",
      value: summary ? formatMXN(summary.total_pending) : "-",
      icon: Clock,
    },
    {
      title: "Aprobados",
      value: summary ? formatMXN(summary.total_approved) : "-",
      icon: CheckCircle,
    },
    {
      title: "Pagados",
      value: summary ? formatMXN(summary.total_paid) : "-",
      icon: CreditCard,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Gastos</h1>
          <p className="text-muted-foreground text-sm">
            Gestiona los gastos de empleados y su validacion fiscal.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-2 size-4" />
          Nuevo Gasto
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.title}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{card.value}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Separator />

      {/* Expenses Table */}
      <Card>
        <CardHeader>
          <CardTitle>Listado de Gastos</CardTitle>
          <CardDescription>
            Todos los gastos registrados con su estado y validacion CFDI.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : expenses.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No hay gastos registrados.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Empleado</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Descripcion</TableHead>
                  <TableHead className="text-right">Monto (MXN)</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-center">CFDI</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.map((expense) => (
                  <TableRow key={expense.id}>
                    <TableCell className="font-medium">#{expense.id}</TableCell>
                    <TableCell>{expense.employee_name}</TableCell>
                    <TableCell className="capitalize">{expense.category || "-"}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-muted-foreground">
                      {expense.description || "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatMXN(expense.amount)}
                    </TableCell>
                    <TableCell>{statusBadge(expense.status)}</TableCell>
                    <TableCell className="text-center">
                      {expense.cfdi_uuid ? (
                        <Check className="mx-auto size-4 text-green-600" />
                      ) : (
                        <X className="mx-auto size-4 text-muted-foreground" />
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(expense.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={actionLoading === expense.id}
                          >
                            {actionLoading === expense.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <MoreHorizontal className="size-4" />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleAction(expense.id, "submit")}>
                            <Send className="mr-2 size-4" />
                            Enviar
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleAction(expense.id, "approve")}>
                            <CheckCircle className="mr-2 size-4" />
                            Aprobar
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => handleAction(expense.id, "reject")}
                          >
                            <XCircle className="mr-2 size-4" />
                            Rechazar
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleAction(expense.id, "pay")}>
                            <Banknote className="mr-2 size-4" />
                            Pagar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* New Expense Dialog */}
      <NewExpenseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={fetchData}
      />
    </div>
  );
}
