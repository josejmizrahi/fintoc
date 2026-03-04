"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import { Payment } from "@/types";
import { toast } from "sonner";
import {
  Plus,
  Play,
  Loader2,
  CalendarClock,
  CreditCard,
  RefreshCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/* ---------- helpers ---------- */

function formatMXN(amount: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(amount);
}

type BadgeVariant =
  | "default"
  | "secondary"
  | "outline"
  | "destructive";

const STATUS_BADGE: Record<string, { label: string; variant: BadgeVariant }> = {
  completed: { label: "Completado", variant: "default" },
  confirmed: { label: "Confirmado", variant: "default" },
  processing: { label: "Procesando", variant: "secondary" },
  pending: { label: "Pendiente", variant: "secondary" },
  pending_approval: { label: "Por aprobar", variant: "outline" },
  failed: { label: "Fallido", variant: "destructive" },
  scheduled: { label: "Programado", variant: "secondary" },
};

function statusBadge(status: string) {
  const cfg = STATUS_BADGE[status] ?? { label: status, variant: "secondary" as BadgeVariant };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

/* ---------- NewPaymentDialog ---------- */

interface NewPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

function NewPaymentDialog({ open, onOpenChange, onSuccess }: NewPaymentDialogProps) {
  const [vendor, setVendor] = useState("");
  const [amount, setAmount] = useState("");
  const [clabe, setClabe] = useState("");
  const [reference, setReference] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function resetForm() {
    setVendor("");
    setAmount("");
    setClabe("");
    setReference("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!vendor || !amount || !clabe) {
      toast.error("Completa los campos requeridos");
      return;
    }
    setSubmitting(true);
    try {
      await api.payments.payVendor({
        vendor_name: vendor,
        amount: parseFloat(amount),
        clabe_destination: clabe,
        reference_id: reference || undefined,
      });
      toast.success("Pago creado exitosamente");
      resetForm();
      onOpenChange(false);
      onSuccess();
    } catch (err: any) {
      toast.error(err.message || "Error al crear el pago");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo Pago</DialogTitle>
          <DialogDescription>
            Ingresa los datos para realizar un pago a proveedor.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="vendor">Proveedor</Label>
            <Input
              id="vendor"
              placeholder="Buscar proveedor..."
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="amount">Monto (MXN)</Label>
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
            <Label htmlFor="clabe">CLABE destino</Label>
            <Input
              id="clabe"
              placeholder="18 digitos"
              maxLength={18}
              value={clabe}
              onChange={(e) => setClabe(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="reference">Concepto / Referencia</Label>
            <Input
              id="reference"
              placeholder="Referencia del pago"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
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
              Pagar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Main Page ---------- */

export default function PagosPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [scheduled, setScheduled] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [executingId, setExecutingId] = useState<number | null>(null);

  async function fetchPayments() {
    setLoading(true);
    try {
      const [all, sched] = await Promise.all([
        api.payments.list(),
        api.payments.scheduled(),
      ]);
      setPayments(all);
      setScheduled(sched);
    } catch (err: any) {
      toast.error(err.message || "Error al cargar pagos");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchPayments();
  }, []);

  // Auto-poll processing payments every 15s
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const hasProcessing = payments.some((p) => p.status === "processing");
    if (hasProcessing && !pollingRef.current) {
      pollingRef.current = setInterval(async () => {
        try {
          await api.payments.pollStuck();
          fetchPayments();
        } catch { /* ignore */ }
      }, 15000);
    } else if (!hasProcessing && pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    return () => { if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; } };
  }, [payments]);

  const [pollingId, setPollingId] = useState<number | null>(null);
  async function handlePollStatus(id: number) {
    setPollingId(id);
    try {
      const result = await api.payments.pollStatus(id);
      if (result.status === "confirmed") toast.success("Pago confirmado por Fintoc");
      else if (result.status === "failed") toast.error("Pago falló en Fintoc");
      else toast.info("Pago aún en proceso");
      fetchPayments();
    } catch { toast.error("Error al verificar status"); }
    finally { setPollingId(null); }
  }

  async function handleExecute(id: number) {
    setExecutingId(id);
    try {
      await api.payments.execute(id);
      toast.success("Pago ejecutado");
      fetchPayments();
    } catch (err: any) {
      toast.error(err.message || "Error al ejecutar el pago");
    } finally {
      setExecutingId(null);
    }
  }

  function formatDate(dateStr?: string) {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("es-MX", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  /* ---------- render ---------- */

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pagos</h1>
          <p className="text-muted-foreground text-sm">
            Gestiona pagos a proveedores y transferencias SPEI.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-2 size-4" />
          Nuevo Pago
        </Button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="todos">
        <TabsList>
          <TabsTrigger value="todos">
            <CreditCard className="mr-1.5 size-4" />
            Todos
          </TabsTrigger>
          <TabsTrigger value="programados">
            <CalendarClock className="mr-1.5 size-4" />
            Programados
          </TabsTrigger>
        </TabsList>

        {/* ---- Tab: Todos ---- */}
        <TabsContent value="todos">
          <Card>
            <CardHeader>
              <CardTitle>Historial de pagos</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              ) : payments.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No hay pagos registrados.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Proveedor</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Referencia</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">#{p.id}</TableCell>
                        <TableCell>{p.partner_name || "-"}</TableCell>
                        <TableCell className="text-right font-mono">
                          {formatMXN(p.amount)}
                        </TableCell>
                        <TableCell>{statusBadge(p.status)}</TableCell>
                        <TableCell className="max-w-[180px] truncate text-muted-foreground">
                          {p.reference_id || "-"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(p.created_at)}
                        </TableCell>
                        <TableCell className="text-right space-x-1">
                          {p.status === "pending_approval" && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleExecute(p.id)}
                              disabled={executingId === p.id}
                            >
                              {executingId === p.id ? (
                                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                              ) : (
                                <Play className="mr-1.5 size-3.5" />
                              )}
                              Ejecutar
                            </Button>
                          )}
                          {p.status === "processing" && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handlePollStatus(p.id)}
                              disabled={pollingId === p.id}
                            >
                              {pollingId === p.id ? (
                                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                              ) : (
                                <RefreshCw className="mr-1.5 size-3.5" />
                              )}
                              Verificar
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Tab: Programados ---- */}
        <TabsContent value="programados">
          <Card>
            <CardHeader>
              <CardTitle>Pagos programados</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              ) : scheduled.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No hay pagos programados.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Proveedor</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Referencia</TableHead>
                      <TableHead>Fecha programada</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {scheduled.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">#{p.id}</TableCell>
                        <TableCell>{p.partner_name || "-"}</TableCell>
                        <TableCell className="text-right font-mono">
                          {formatMXN(p.amount)}
                        </TableCell>
                        <TableCell>{statusBadge(p.status)}</TableCell>
                        <TableCell className="max-w-[180px] truncate text-muted-foreground">
                          {p.reference_id || "-"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(p.executed_at || p.created_at)}
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

      {/* New Payment Dialog */}
      <NewPaymentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={fetchPayments}
      />
    </div>
  );
}
