"use client";

import { useState, useMemo, useCallback } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  Plus,
  Loader2,
  CheckCircle2,
  XCircle,
  FileText,
  Upload,
  Receipt,
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
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { SearchInput } from "@/components/shared/search-input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";

import {
  useExpenses,
  useCreateExpense,
  useApproveExpense,
  useRejectExpense,
} from "@/lib/hooks/use-expenses";
import { useExpenseFilters } from "@/lib/hooks/use-url-state";
import { formatMoney, formatDate } from "@/lib/utils/format";
import { EXPENSE_CATEGORIES } from "@/lib/utils/constants";

import type { Expense } from "@/types";

/* ---------- Zod schema for new expense ---------- */

const newExpenseSchema = z.object({
  employee_name: z.string().min(1, "Nombre del empleado requerido"),
  category: z.string().min(1, "Selecciona una categoria"),
  description: z.string().max(200, "Maximo 200 caracteres").optional(),
  amount: z.number().positive("El monto debe ser mayor a 0"),
  date: z.string().refine(
    (val) => {
      if (!val) return true;
      return new Date(val) <= new Date();
    },
    { message: "La fecha no puede ser futura" }
  ),
});

type NewExpenseForm = z.infer<typeof newExpenseSchema>;

/* ---------- Reject reason schema ---------- */

const rejectSchema = z.object({
  reason: z.string().min(1, "Ingresa un motivo de rechazo"),
});

type RejectForm = z.infer<typeof rejectSchema>;

/* ---------- Columns ---------- */

function useExpenseColumns(
  onApprove: (id: string) => void,
  onRejectOpen: (id: string) => void,
  approvingId: string | null
): ColumnDef<Expense, any>[] {
  return useMemo(
    () => [
      {
        accessorKey: "created_at",
        header: "Fecha",
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">
            {getValue() ? formatDate(getValue<string>()) : "-"}
          </span>
        ),
      },
      {
        accessorKey: "employee_name",
        header: "Empleado",
        cell: ({ getValue }) => (
          <span className="font-medium">{getValue<string>()}</span>
        ),
      },
      {
        accessorKey: "category",
        header: "Categoria",
        cell: ({ getValue }) => (
          <span className="capitalize">{getValue<string>() || "-"}</span>
        ),
      },
      {
        accessorKey: "description",
        header: "Descripcion",
        cell: ({ getValue }) => (
          <span className="max-w-[200px] truncate block text-muted-foreground">
            {getValue<string>() || "-"}
          </span>
        ),
      },
      {
        accessorKey: "amount",
        header: () => <span className="text-right block">Monto</span>,
        cell: ({ getValue }) => (
          <span className="text-right font-mono block">
            {formatMoney(getValue<number>())}
          </span>
        ),
      },
      {
        accessorKey: "cfdi_uuid",
        header: () => <span className="text-center block">CFDI</span>,
        cell: ({ getValue }) =>
          getValue() ? (
            <FileText className="size-4 text-green-600 mx-auto" />
          ) : (
            <XCircle className="size-4 text-muted-foreground mx-auto" />
          ),
      },
      {
        accessorKey: "status",
        header: "Estado",
        cell: ({ getValue }) => <StatusBadge status={getValue<string>()} />,
      },
      {
        id: "actions",
        header: () => <span className="text-right block">Acciones</span>,
        cell: ({ row }) => {
          const expense = row.original;
          if (
            expense.status !== "pending" &&
            expense.status !== "submitted" &&
            expense.status !== "draft"
          )
            return null;

          const isPending =
            expense.status === "pending" || expense.status === "submitted";

          return (
            <div className="flex items-center justify-end gap-2">
              {isPending && (
                <>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => onApprove(expense.id)}
                    disabled={approvingId === expense.id}
                  >
                    {approvingId === expense.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="size-3.5" />
                    )}
                    <span className="ml-1">Aprobar</span>
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => onRejectOpen(expense.id)}
                    disabled={approvingId === expense.id}
                  >
                    <XCircle className="size-3.5" />
                    <span className="ml-1">Rechazar</span>
                  </Button>
                </>
              )}
            </div>
          );
        },
      },
    ],
    [onApprove, onRejectOpen, approvingId]
  );
}

/* ---------- NewExpenseDialog ---------- */

function NewExpenseDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const createExpense = useCreateExpense();
  const [xmlFile, setXmlFile] = useState<File | null>(null);

  const form = useForm<NewExpenseForm>({
    resolver: zodResolver(newExpenseSchema) as any,
    defaultValues: {
      employee_name: "",
      category: "",
      description: "",
      amount: 0,
      date: new Date().toISOString().slice(0, 10),
    },
  });

  async function onSubmit(data: NewExpenseForm) {
    await createExpense.mutateAsync({
      ...data,
      currency: "MXN",
      cfdi_file: xmlFile ? xmlFile.name : undefined,
    });
    form.reset();
    setXmlFile(null);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo Gasto</DialogTitle>
          <DialogDescription>
            Registra un nuevo gasto de empleado.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="employee_name">Empleado *</Label>
            <Input
              id="employee_name"
              placeholder="Nombre del empleado"
              {...form.register("employee_name")}
            />
            {form.formState.errors.employee_name && (
              <p className="text-xs text-destructive">
                {form.formState.errors.employee_name.message}
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="category">Categoria *</Label>
            <Controller
              control={form.control}
              name="category"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar categoria" />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPENSE_CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat.toLowerCase()}>
                        {cat}
                      </SelectItem>
                    ))}
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

          <div className="grid gap-2">
            <Label htmlFor="description">Descripcion</Label>
            <Textarea
              id="description"
              placeholder="Descripcion del gasto (max 200 caracteres)"
              maxLength={200}
              {...form.register("description")}
            />
            {form.formState.errors.description && (
              <p className="text-xs text-destructive">
                {form.formState.errors.description.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="amount">Monto *</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                {...form.register("amount")}
              />
              {form.formState.errors.amount && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.amount.message}
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="date">Fecha</Label>
              <Input
                id="date"
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                {...form.register("date")}
              />
              {form.formState.errors.date && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.date.message}
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="xml_cfdi">XML CFDI (opcional)</Label>
            <div className="flex items-center gap-2">
              <Input
                id="xml_cfdi"
                type="file"
                accept=".xml"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) setXmlFile(file);
                }}
              />
              {xmlFile && (
                <Badge variant="secondary" className="shrink-0">
                  <Upload className="size-3 mr-1" />
                  {xmlFile.name}
                </Badge>
              )}
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createExpense.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={createExpense.isPending}>
              {createExpense.isPending && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Crear Gasto
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Main Page ---------- */

export default function GastosPage() {
  const [filters, setFilters] = useExpenseFilters();
  const [tab, setTab] = useState("todos");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const statusFilter = tab === "todos" ? undefined : tab;

  const { data: expensesData, isLoading } = useExpenses({
    status: statusFilter || filters.status || undefined,
    search: filters.search || undefined,
    page: filters.page,
    per_page: filters.per_page,
    date_from: filters.date_from || undefined,
    date_to: filters.date_to || undefined,
  });

  const approveExpense = useApproveExpense();
  const rejectExpense = useRejectExpense();

  const rejectForm = useForm<RejectForm>({
    resolver: zodResolver(rejectSchema),
    defaultValues: { reason: "" },
  });

  const expenses: Expense[] = useMemo(() => {
    if (!expensesData) return [];
    if (Array.isArray(expensesData)) return expensesData;
    const d = expensesData as unknown as Record<string, unknown>;
    return (d.data as Expense[]) ?? [];
  }, [expensesData]);

  const totalExpenses = expenses.length;

  const handleApprove = useCallback(
    async (id: string) => {
      setApprovingId(id);
      try {
        await approveExpense.mutateAsync(id);
      } finally {
        setApprovingId(null);
      }
    },
    [approveExpense]
  );

  const handleRejectOpen = useCallback((id: string) => {
    setRejectingId(id);
    setRejectDialogOpen(true);
  }, []);

  async function handleRejectSubmit(data: RejectForm) {
    if (!rejectingId) return;
    await rejectExpense.mutateAsync({ id: rejectingId, reason: data.reason });
    setRejectDialogOpen(false);
    setRejectingId(null);
    rejectForm.reset();
  }

  const columns = useExpenseColumns(handleApprove, handleRejectOpen, approvingId);

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

      {/* Tabs + DataTable */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="todos">Todos</TabsTrigger>
          <TabsTrigger value="pending">Pendientes</TabsTrigger>
          <TabsTrigger value="approved">Aprobados</TabsTrigger>
          <TabsTrigger value="rejected">Rechazados</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Listado de Gastos</CardTitle>
              <CardDescription>
                {tab === "todos"
                  ? "Todos los gastos registrados con su estado y validacion CFDI."
                  : tab === "pending"
                  ? "Gastos pendientes de aprobacion."
                  : tab === "approved"
                  ? "Gastos aprobados."
                  : "Gastos rechazados con motivo."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={columns}
                data={expenses}
                isLoading={isLoading}
                pagination={{
                  page: filters.page,
                  pageSize: filters.per_page,
                  total: totalExpenses,
                }}
                onPaginationChange={(p) =>
                  setFilters({ page: p.page, per_page: p.pageSize })
                }
                emptyState={
                  <EmptyState
                    icon={Receipt}
                    title="Sin gastos"
                    description="No hay gastos registrados en esta categoria."
                  />
                }
                toolbar={
                  <SearchInput
                    value={filters.search}
                    onChange={(v) => setFilters({ search: v, page: 1 })}
                    placeholder="Buscar por empleado, descripcion..."
                  />
                }
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* New Expense Dialog */}
      <NewExpenseDialog open={dialogOpen} onOpenChange={setDialogOpen} />

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rechazar Gasto</DialogTitle>
            <DialogDescription>
              Indica el motivo del rechazo de este gasto.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={rejectForm.handleSubmit(handleRejectSubmit)}
            className="grid gap-4 py-2"
          >
            <div className="grid gap-2">
              <Label htmlFor="reject-reason">Motivo de rechazo</Label>
              <Textarea
                id="reject-reason"
                placeholder="Explica por que se rechaza..."
                rows={3}
                {...rejectForm.register("reason")}
              />
              {rejectForm.formState.errors.reason && (
                <p className="text-xs text-destructive">
                  {rejectForm.formState.errors.reason.message}
                </p>
              )}
            </div>
            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setRejectDialogOpen(false)}
                disabled={rejectExpense.isPending}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={rejectExpense.isPending}
              >
                {rejectExpense.isPending && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                Rechazar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
