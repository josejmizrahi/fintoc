"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { api } from "@/lib/api";
import { Payment, Vendor } from "@/types";
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
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorSearch, setVendorSearch] = useState("");
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [amount, setAmount] = useState("");
  const [clabe, setClabe] = useState("");
  const [reference, setReference] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load vendors when dialog opens
  useEffect(() => {
    if (open) {
      api.vendors.list().then(setVendors).catch(() => {});
    }
  }, [open]);

  const filteredVendors = useMemo(() => {
    if (!vendorSearch.trim()) return vendors;
    const q = vendorSearch.toLowerCase();
    return vendors.filter(
      (v) =>
        v.name?.toLowerCase().includes(q) ||
        v.rfc?.toLowerCase().includes(q)
    );
  }, [vendors, vendorSearch]);

  function selectVendor(v: Vendor) {
    setSelectedVendor(v);
    setVendorSearch(v.name || "");
    setShowDropdown(false);
    if (v.clabe) setClabe(v.clabe);
  }

  function resetForm() {
    setSelectedVendor(null);
    setVendorSearch("");
    setAmount("");
    setClabe("");
    setReference("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const vendorName = selectedVendor?.name || vendorSearch.trim();
    if (!vendorName || !amount || !clabe) {
      toast.error("Completa los campos requeridos");
      return;
    }
    setSubmitting(true);
    try {
      await api.payments.payVendor({
        vendor_name: vendorName,
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
          <div className="grid gap-2 relative" ref={dropdownRef}>
            <Label htmlFor="vendor">Proveedor</Label>
            <Input
              id="vendor"
              placeholder="Buscar proveedor..."
              value={vendorSearch}
              onChange={(e) => {
                setVendorSearch(e.target.value);
                setSelectedVendor(null);
                setShowDropdown(true);
              }}
              onFocus={() => setShowDropdown(true)}
              autoComplete="off"
            />
            {showDropdown && filteredVendors.length > 0 && (
              <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-48 overflow-y-auto rounded-md border bg-popover shadow-md">
                {filteredVendors.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-accent text-left"
                    onClick={() => selectVendor(v)}
                  >
                    <span className="font-medium">{v.name}</span>
                    {v.clabe && (
                      <span className="text-xs text-muted-foreground font-mono ml-2">
                        CLABE: ...{v.clabe.slice(-4)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
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
              placeholder="18 dígitos"
              maxLength={18}
              value={clabe}
              onChange={(e) => setClabe(e.target.value.replace(/\D/g, "").slice(0, 18))}
              className="font-mono tracking-wider"
            />
            {selectedVendor?.clabe && clabe === selectedVendor.clabe && (
              <p className="text-xs text-muted-foreground">Auto-llenado del proveedor seleccionado</p>
            )}
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

  // Auto-poll processing payments with progressive backoff (#17)
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollStartRef = useRef<number>(0);
  const [pollingExpired, setPollingExpired] = useState(false);

  useEffect(() => {
    const hasProcessing = payments.some((p) => p.status === "processing");
    if (!hasProcessing) {
      if (pollingRef.current) { clearTimeout(pollingRef.current); pollingRef.current = null; }
      pollStartRef.current = 0;
      setPollingExpired(false);
      return;
    }
    if (!pollStartRef.current) pollStartRef.current = Date.now();

    const elapsed = Date.now() - pollStartRef.current;
    // Stop polling after 5 minutes
    if (elapsed > 300000) {
      if (pollingRef.current) { clearTimeout(pollingRef.current); pollingRef.current = null; }
      setPollingExpired(true);
      return;
    }

    const getInterval = () => {
      if (elapsed < 30000) return 5000;     // First 30s: 5s
      if (elapsed < 150000) return 15000;   // Next 2min: 15s
      return 30000;                          // After: 30s
    };

    const doPoll = async () => {
      try {
        await api.payments.pollStuck();
        fetchPayments();
      } catch { /* ignore */ }
      pollingRef.current = setTimeout(doPoll, getInterval());
    };

    if (!pollingRef.current) {
      pollingRef.current = setTimeout(doPoll, getInterval());
    }

    return () => { if (pollingRef.current) { clearTimeout(pollingRef.current); pollingRef.current = null; } };
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
