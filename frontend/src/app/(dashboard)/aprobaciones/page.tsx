"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import { ApprovalRequest } from "@/types";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Plus,
  ShieldCheck,
  ListChecks,
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";

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

/* ---------- RejectDialog ---------- */

interface RejectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
  submitting: boolean;
}

function RejectDialog({ open, onOpenChange, onConfirm, submitting }: RejectDialogProps) {
  const [reason, setReason] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      toast.error("Ingresa una razon de rechazo");
      return;
    }
    onConfirm(reason);
    setReason("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rechazar Aprobacion</DialogTitle>
          <DialogDescription>
            Indica la razon por la cual se rechaza esta solicitud.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="reject-reason">Razon de rechazo</Label>
            <Textarea
              id="reject-reason"
              placeholder="Explica por que se rechaza..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
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
            <Button type="submit" variant="destructive" disabled={submitting}>
              {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Rechazar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- NewRuleDialog ---------- */

interface NewRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

function NewRuleDialog({ open, onOpenChange, onSuccess }: NewRuleDialogProps) {
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [levels, setLevels] = useState("");
  const [approvers, setApprovers] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function resetForm() {
    setMinAmount("");
    setMaxAmount("");
    setLevels("");
    setApprovers("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!minAmount || !maxAmount || !levels || !approvers.trim()) {
      toast.error("Completa todos los campos");
      return;
    }
    setSubmitting(true);
    try {
      const approverList = approvers
        .split(",")
        .map((email) => email.trim())
        .filter(Boolean);
      await api.approvals.createRule({
        min_amount: parseFloat(minAmount),
        max_amount: parseFloat(maxAmount),
        levels: parseInt(levels, 10),
        approvers: approverList,
      });
      toast.success("Regla creada exitosamente");
      resetForm();
      onOpenChange(false);
      onSuccess();
    } catch (err: any) {
      toast.error(err.message || "Error al crear la regla");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nueva Regla de Aprobacion</DialogTitle>
          <DialogDescription>
            Define los rangos de monto y los aprobadores requeridos.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="min-amount">Monto Minimo (MXN)</Label>
              <Input
                id="min-amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={minAmount}
                onChange={(e) => setMinAmount(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="max-amount">Monto Maximo (MXN)</Label>
              <Input
                id="max-amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={maxAmount}
                onChange={(e) => setMaxAmount(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="levels">Niveles de aprobacion</Label>
            <Input
              id="levels"
              type="number"
              min="1"
              max="5"
              placeholder="1"
              value={levels}
              onChange={(e) => setLevels(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="approvers">Aprobadores (emails separados por coma)</Label>
            <Textarea
              id="approvers"
              placeholder="admin@empresa.com, finanzas@empresa.com"
              value={approvers}
              onChange={(e) => setApprovers(e.target.value)}
              rows={3}
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
  const { user } = useAuthStore();
  const userEmail = user?.email || "";

  const [pending, setPending] = useState<ApprovalRequest[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [actionId, setActionId] = useState<number | null>(null);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function fetchPending() {
    setLoading(true);
    try {
      const data = await api.approvals.pending(userEmail);
      setPending(data);
    } catch (err: any) {
      toast.error(err.message || "Error al cargar aprobaciones pendientes");
    } finally {
      setLoading(false);
    }
  }

  async function fetchRules() {
    setRulesLoading(true);
    try {
      const data = await api.approvals.rules();
      setRules(data);
    } catch (err: any) {
      toast.error(err.message || "Error al cargar reglas");
    } finally {
      setRulesLoading(false);
    }
  }

  useEffect(() => {
    fetchPending();
    fetchRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleApprove(id: number) {
    setActionId(id);
    try {
      await api.approvals.approve(id, {
        approved_by: userEmail,
        comments: "",
      });
      toast.success("Aprobacion registrada");
      fetchPending();
    } catch (err: any) {
      toast.error(err.message || "Error al aprobar");
    } finally {
      setActionId(null);
    }
  }

  function openRejectDialog(id: number) {
    setRejectingId(id);
    setRejectDialogOpen(true);
  }

  async function handleReject(reason: string) {
    if (!rejectingId) return;
    setSubmitting(true);
    try {
      await api.approvals.reject(rejectingId, {
        rejected_by: userEmail,
        reason,
      });
      toast.success("Solicitud rechazada");
      setRejectDialogOpen(false);
      setRejectingId(null);
      fetchPending();
    } catch (err: any) {
      toast.error(err.message || "Error al rechazar");
    } finally {
      setSubmitting(false);
    }
  }

  /* ---------- render ---------- */

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
          <TabsTrigger value="pendientes">
            <ListChecks className="mr-1.5 size-4" />
            Pendientes
          </TabsTrigger>
          <TabsTrigger value="reglas">
            <ShieldCheck className="mr-1.5 size-4" />
            Reglas
          </TabsTrigger>
        </TabsList>

        {/* ---- Tab: Pendientes ---- */}
        <TabsContent value="pendientes">
          <Card>
            <CardHeader>
              <CardTitle>Aprobaciones Pendientes</CardTitle>
              <CardDescription>
                Pagos que requieren tu autorizacion para ser ejecutados.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              ) : pending.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No hay aprobaciones pendientes.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID Pago</TableHead>
                      <TableHead>Proveedor</TableHead>
                      <TableHead className="text-right">Monto (MXN)</TableHead>
                      <TableHead>Nivel</TableHead>
                      <TableHead>Solicitado</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pending.map((item) => (
                      <TableRow key={item.approval_id}>
                        <TableCell className="font-medium">
                          #{item.payment_id}
                        </TableCell>
                        <TableCell>{item.payment_partner || "-"}</TableCell>
                        <TableCell className="text-right font-mono">
                          {formatMXN(item.payment_amount)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">Nivel {item.level}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(item.created_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => handleApprove(item.approval_id)}
                              disabled={actionId === item.approval_id}
                            >
                              {actionId === item.approval_id ? (
                                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="mr-1.5 size-3.5" />
                              )}
                              Aprobar
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => openRejectDialog(item.approval_id)}
                              disabled={actionId === item.approval_id}
                            >
                              <XCircle className="mr-1.5 size-3.5" />
                              Rechazar
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Tab: Reglas ---- */}
        <TabsContent value="reglas">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Reglas de Aprobacion</CardTitle>
                <CardDescription>
                  Configura los niveles y montos requeridos para aprobacion.
                </CardDescription>
              </div>
              <Button onClick={() => setRuleDialogOpen(true)}>
                <Plus className="mr-2 size-4" />
                Nueva Regla
              </Button>
            </CardHeader>
            <CardContent>
              {rulesLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              ) : rules.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No hay reglas configuradas.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">Monto Min</TableHead>
                      <TableHead className="text-right">Monto Max</TableHead>
                      <TableHead>Niveles</TableHead>
                      <TableHead>Aprobadores</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rules.map((rule, idx) => (
                      <TableRow key={rule.id ?? idx}>
                        <TableCell className="text-right font-mono">
                          {formatMXN(rule.min_amount)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatMXN(rule.max_amount)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{rule.levels}</Badge>
                        </TableCell>
                        <TableCell className="max-w-[300px]">
                          <div className="flex flex-wrap gap-1">
                            {(rule.approvers || []).map((email: string, i: number) => (
                              <Badge key={i} variant="outline" className="text-xs">
                                {email}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <RejectDialog
        open={rejectDialogOpen}
        onOpenChange={setRejectDialogOpen}
        onConfirm={handleReject}
        submitting={submitting}
      />
      <NewRuleDialog
        open={ruleDialogOpen}
        onOpenChange={setRuleDialogOpen}
        onSuccess={fetchRules}
      />
    </div>
  );
}
