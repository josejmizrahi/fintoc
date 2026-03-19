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
  CheckCircle2,
  XCircle,
  ShieldCheck,
  ListChecks,
  MoreHorizontal,
  FileText,
  User,
  Calendar,
  DollarSign,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { PermissionGate } from "@/components/shared/permission-gate";

import { api } from "@/lib/api";
import { formatMoney, formatDate } from "@/lib/utils/format";
import type { ApprovalRequest } from "@/types";

/* ---------- Query keys ---------- */

const approvalKeys = {
  all: ["approvals"] as const,
  rules: () => [...approvalKeys.all, "rules"] as const,
  pending: () => [...approvalKeys.all, "pending"] as const,
};

/* ---------- Zod schemas ---------- */

const newRuleSchema = z.object({
  name: z.string().min(1, "Nombre de la regla requerido"),
  min_amount: z.number().min(0, "Monto minimo debe ser >= 0"),
  max_amount: z.number().positive("Monto maximo debe ser > 0"),
  approvers: z.string().min(1, "Al menos un aprobador requerido"),
  auto_approve: z.boolean(),
});

type NewRuleForm = z.infer<typeof newRuleSchema>;

const rejectReasonSchema = z.object({
  reason: z.string().min(1, "Ingresa un motivo de rechazo"),
});

type RejectReasonForm = z.infer<typeof rejectReasonSchema>;

/* ---------- Rule type ---------- */

interface ApprovalRule {
  id: string;
  name: string;
  min_amount: number;
  max_amount: number;
  approvers: string[];
  auto_approve: boolean;
  is_active: boolean;
  levels?: number;
}

/* ---------- Rules DataTable Columns ---------- */

const ruleColumns: ColumnDef<ApprovalRule, unknown>[] = [
  {
    accessorKey: "name",
    header: "Nombre",
    cell: ({ getValue }) => (
      <span className="font-medium">{getValue<string>()}</span>
    ),
  },
  {
    accessorKey: "min_amount",
    header: () => <span className="text-right block">Monto Min</span>,
    cell: ({ getValue }) => (
      <span className="text-right font-mono block">
        {formatMoney(getValue<number>())}
      </span>
    ),
  },
  {
    accessorKey: "max_amount",
    header: () => <span className="text-right block">Monto Max</span>,
    cell: ({ getValue }) => (
      <span className="text-right font-mono block">
        {formatMoney(getValue<number>())}
      </span>
    ),
  },
  {
    accessorKey: "approvers",
    header: "Aprobadores",
    cell: ({ getValue }) => {
      const approvers = getValue<string[]>() || [];
      return (
        <div className="flex flex-wrap gap-1 max-w-[300px]">
          {approvers.map((email, i) => (
            <Badge key={i} variant="outline" className="text-xs">
              {email}
            </Badge>
          ))}
        </div>
      );
    },
  },
  {
    accessorKey: "auto_approve",
    header: "Auto-aprobar",
    cell: ({ getValue }) =>
      getValue<boolean>() ? (
        <Badge className="bg-green-600 text-white">Si</Badge>
      ) : (
        <Badge variant="secondary">No</Badge>
      ),
  },
  {
    accessorKey: "is_active",
    header: "Activa",
    cell: ({ getValue }) =>
      getValue<boolean>() ? (
        <CheckCircle2 className="size-4 text-green-600" />
      ) : (
        <XCircle className="size-4 text-muted-foreground" />
      ),
  },
  {
    id: "actions",
    header: () => <span className="text-right block">Acciones</span>,
    cell: () => (
      <div className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>Editar</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive">
              Desactivar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    ),
  },
];

/* ---------- NewRuleDialog ---------- */

function NewRuleDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();

  const createRule = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.approvals.createRule(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: approvalKeys.rules() });
      toast.success("Regla creada exitosamente");
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Error al crear la regla");
    },
  });

  const form = useForm<NewRuleForm>({
    resolver: zodResolver(newRuleSchema),
    defaultValues: {
      name: "",
      min_amount: 0,
      max_amount: 0,
      approvers: "",
      auto_approve: false,
    },
  });

  function onSubmit(data: NewRuleForm) {
    const approverList = data.approvers
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);

    createRule.mutate({
      name: data.name,
      min_amount: data.min_amount,
      max_amount: data.max_amount,
      approvers: approverList,
      auto_approve: data.auto_approve,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nueva Regla de Aprobacion</DialogTitle>
          <DialogDescription>
            Define rangos de monto y aprobadores requeridos.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="rule-name">Nombre *</Label>
            <Input
              id="rule-name"
              placeholder="Nombre de la regla"
              {...form.register("name")}
            />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="min-amount">Monto Minimo (MXN)</Label>
              <Input
                id="min-amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                {...form.register("min_amount")}
              />
              {form.formState.errors.min_amount && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.min_amount.message}
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="max-amount">Monto Maximo (MXN)</Label>
              <Input
                id="max-amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                {...form.register("max_amount")}
              />
              {form.formState.errors.max_amount && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.max_amount.message}
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="approvers">
              Aprobadores (emails separados por coma)
            </Label>
            <Textarea
              id="approvers"
              placeholder="admin@empresa.com, finanzas@empresa.com"
              rows={3}
              {...form.register("approvers")}
            />
            {form.formState.errors.approvers && (
              <p className="text-xs text-destructive">
                {form.formState.errors.approvers.message}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Controller
              control={form.control}
              name="auto_approve"
              render={({ field }) => (
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
            <Label>Auto-aprobar cuando se cumpla la regla</Label>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createRule.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={createRule.isPending}>
              {createRule.isPending && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Crear Regla
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Main Page ---------- */

export default function AprobacionesPage() {
  const queryClient = useQueryClient();
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  /* ----- Queries ----- */

  const { data: rulesData, isLoading: rulesLoading } = useQuery({
    queryKey: approvalKeys.rules(),
    queryFn: () => api.approvals.rules(),
    staleTime: 30_000,
  });

  const { data: pendingData, isLoading: pendingLoading } = useQuery({
    queryKey: approvalKeys.pending(),
    queryFn: () => api.approvals.pending(),
    staleTime: 15_000,
  });

  /* ----- Mutations ----- */

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.approvals.approve(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: approvalKeys.pending() });
      const previous = queryClient.getQueryData(approvalKeys.pending());
      queryClient.setQueryData(approvalKeys.pending(), (old: ApprovalRequest[] | undefined) =>
        Array.isArray(old)
          ? old.filter((item) => item.approval_id !== id)
          : old
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(approvalKeys.pending(), context.previous);
      }
      toast.error("Error al aprobar");
    },
    onSuccess: () => {
      toast.success("Aprobacion registrada");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: approvalKeys.pending() });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.approvals.reject(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: approvalKeys.pending() });
      toast.success("Solicitud rechazada");
      setRejectDialogOpen(false);
      setRejectingId(null);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Error al rechazar");
    },
  });

  const rejectForm = useForm<RejectReasonForm>({
    resolver: zodResolver(rejectReasonSchema),
    defaultValues: { reason: "" },
  });

  function handleRejectSubmit(data: RejectReasonForm) {
    if (!rejectingId) return;
    rejectMutation.mutate({ id: rejectingId, reason: data.reason });
  }

  const rules: ApprovalRule[] = useMemo(
    () => (Array.isArray(rulesData) ? rulesData : []),
    [rulesData]
  );

  const pending: ApprovalRequest[] = useMemo(
    () => (Array.isArray(pendingData) ? pendingData : []),
    [pendingData]
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Aprobaciones</h1>
        <p className="text-muted-foreground text-sm">
          Gestiona solicitudes de aprobacion y reglas de autorizacion.
        </p>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="pendientes">
        <TabsList>
          <TabsTrigger value="reglas">
            <ShieldCheck className="mr-1.5 size-4" />
            Reglas
          </TabsTrigger>
          <TabsTrigger value="pendientes">
            <ListChecks className="mr-1.5 size-4" />
            Pendientes
            {pending.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {pending.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ---- Tab: Reglas (admin only) ---- */}
        <TabsContent value="reglas">
          <PermissionGate
            permission="approvals.manage"
            fallback={
              <EmptyState
                icon={ShieldCheck}
                title="Acceso restringido"
                description="Solo administradores pueden gestionar reglas de aprobacion."
              />
            }
          >
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Reglas de Aprobacion</CardTitle>
                  <CardDescription>
                    Configura los rangos de monto y aprobadores requeridos.
                  </CardDescription>
                </div>
                <Button onClick={() => setRuleDialogOpen(true)}>
                  <Plus className="mr-2 size-4" />
                  Nueva Regla
                </Button>
              </CardHeader>
              <CardContent>
                <DataTable
                  columns={ruleColumns}
                  data={rules}
                  isLoading={rulesLoading}
                  emptyState={
                    <EmptyState
                      icon={ShieldCheck}
                      title="Sin reglas"
                      description="No hay reglas de aprobacion configuradas."
                      action={{
                        label: "Crear primera regla",
                        onClick: () => setRuleDialogOpen(true),
                      }}
                    />
                  }
                />
              </CardContent>
            </Card>
          </PermissionGate>
        </TabsContent>

        {/* ---- Tab: Pendientes ---- */}
        <TabsContent value="pendientes">
          {pendingLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : pending.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="Sin aprobaciones pendientes"
              description="No hay pagos que requieran tu autorizacion."
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {pending.map((item) => (
                <Card key={item.approval_id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">
                        {item.payment_partner || "Proveedor"}
                      </CardTitle>
                      <Badge variant="outline">Nivel {item.level}</Badge>
                    </div>
                    <CardDescription>
                      Pago #{item.payment_id}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-2 text-sm">
                      <DollarSign className="size-4 text-muted-foreground" />
                      <span className="font-mono font-semibold text-lg">
                        {formatMoney(item.payment_amount)}
                      </span>
                    </div>
                    {item.approver_email && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <User className="size-4" />
                        <span>Solicitante: {item.approver_email}</span>
                      </div>
                    )}
                    {item.payment_reference && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <FileText className="size-4" />
                        <span>Ref: {item.payment_reference}</span>
                      </div>
                    )}
                    {item.created_at && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Calendar className="size-4" />
                        <span>{formatDate(item.created_at)}</span>
                      </div>
                    )}
                  </CardContent>
                  <CardFooter className="flex gap-2">
                    <Button
                      className="flex-1"
                      onClick={() =>
                        approveMutation.mutate(item.approval_id)
                      }
                      disabled={approveMutation.isPending}
                    >
                      {approveMutation.isPending ? (
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-1.5 size-3.5" />
                      )}
                      Aprobar
                    </Button>
                    <Button
                      variant="destructive"
                      className="flex-1"
                      onClick={() => {
                        setRejectingId(item.approval_id);
                        setRejectDialogOpen(true);
                      }}
                      disabled={rejectMutation.isPending}
                    >
                      <XCircle className="mr-1.5 size-3.5" />
                      Rechazar
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* New Rule Dialog */}
      <NewRuleDialog open={ruleDialogOpen} onOpenChange={setRuleDialogOpen} />

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rechazar Aprobacion</DialogTitle>
            <DialogDescription>
              Indica la razon por la cual se rechaza esta solicitud.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={rejectForm.handleSubmit(handleRejectSubmit)}
            className="grid gap-4 py-2"
          >
            <div className="grid gap-2">
              <Label htmlFor="reject-reason">Razon de rechazo</Label>
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
                disabled={rejectMutation.isPending}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={rejectMutation.isPending}
              >
                {rejectMutation.isPending && (
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
