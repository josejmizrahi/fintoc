"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Invoice } from "@/types";
import { toast } from "sonner";
import {
  Plus,
  RefreshCw,
  Loader2,
  Link2,
  Clock,
  AlertTriangle,
  BarChart3,
  Copy,
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

function formatDate(dateStr?: string): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function daysOverdue(dateStr?: string): number {
  if (!dateStr) return 0;
  const due = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 0;
}

/* ---------- Aging bucket type ---------- */

interface AgingBucket {
  bucket: string;
  count: number;
  total: number;
}

/* ---------- PaymentLinkDialog ---------- */

interface PaymentLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function PaymentLinkDialog({ open, onOpenChange }: PaymentLinkDialogProps) {
  const [partnerId, setPartnerId] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState("");

  function resetForm() {
    setPartnerId("");
    setAmount("");
    setGeneratedUrl("");
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!partnerId || !amount) {
      toast.error("Completa los campos requeridos");
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.collections.paymentLink({
        partner_id: parseInt(partnerId),
        amount: parseFloat(amount),
      });
      setGeneratedUrl(result.payment_url || result.url || JSON.stringify(result));
      toast.success("Link de pago generado");
    } catch (err: any) {
      toast.error(err.message || "Error al generar link de pago");
    } finally {
      setSubmitting(false);
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(generatedUrl);
    toast.success("URL copiada al portapapeles");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        if (!val) resetForm();
        onOpenChange(val);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Generar Link de Pago</DialogTitle>
          <DialogDescription>
            Crea un link de pago para enviar a tu cliente.
          </DialogDescription>
        </DialogHeader>

        {generatedUrl ? (
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>URL de pago</Label>
              <div className="flex items-center gap-2">
                <Input value={generatedUrl} readOnly className="font-mono text-sm" />
                <Button type="button" variant="outline" size="icon" onClick={handleCopy}>
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
            <DialogFooter className="pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cerrar
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleGenerate} className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="partner_id">ID del Cliente</Label>
              <Input
                id="partner_id"
                type="number"
                placeholder="Ej. 42"
                value={partnerId}
                onChange={(e) => setPartnerId(e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="link_amount">Monto (MXN)</Label>
              <Input
                id="link_amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
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
                Generar Link
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Main Page ---------- */

export default function CobranzaPage() {
  const [pending, setPending] = useState<Invoice[]>([]);
  const [overdue, setOverdue] = useState<Invoice[]>([]);
  const [aging, setAging] = useState<AgingBucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupLoading, setSetupLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);

  async function fetchCollections() {
    setLoading(true);
    try {
      const [pendingData, overdueData, agingData] = await Promise.all([
        api.collections.pending(),
        api.collections.overdue(),
        api.collections.aging(),
      ]);
      setPending(pendingData);
      setOverdue(overdueData);
      // aging may come as an object with buckets or as an array
      if (Array.isArray(agingData)) {
        setAging(agingData);
      } else if (agingData && typeof agingData === "object") {
        // Convert object buckets to array
        const buckets: AgingBucket[] = Object.entries(agingData).map(
          ([bucket, value]: [string, any]) => ({
            bucket,
            count: value?.count ?? 0,
            total: value?.total ?? value ?? 0,
          })
        );
        setAging(buckets);
      }
    } catch (err: any) {
      toast.error(err.message || "Error al cargar cobranza");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchCollections();
  }, []);

  async function handleSetupAll() {
    setSetupLoading(true);
    try {
      await api.collections.setupAll();
      toast.success("CLABEs creadas exitosamente");
      fetchCollections();
    } catch (err: any) {
      toast.error(err.message || "Error al crear CLABEs");
    } finally {
      setSetupLoading(false);
    }
  }

  async function handleSync() {
    setSyncLoading(true);
    try {
      await api.collections.sync();
      toast.success("Sincronización completada");
      fetchCollections();
    } catch (err: any) {
      toast.error(err.message || "Error al sincronizar");
    } finally {
      setSyncLoading(false);
    }
  }

  /* ---------- render ---------- */

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cobranza</h1>
          <p className="text-muted-foreground text-sm">
            Gestiona la cobranza de facturas y cuentas por cobrar.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleSetupAll} disabled={setupLoading}>
            {setupLoading ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Plus className="mr-2 size-4" />
            )}
            Crear CLABEs
          </Button>
          <Button variant="outline" onClick={handleSync} disabled={syncLoading}>
            {syncLoading ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 size-4" />
            )}
            Sincronizar
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="pendientes">
        <TabsList>
          <TabsTrigger value="pendientes">
            <Clock className="mr-1.5 size-4" />
            Pendientes
          </TabsTrigger>
          <TabsTrigger value="vencidas">
            <AlertTriangle className="mr-1.5 size-4" />
            Vencidas
          </TabsTrigger>
          <TabsTrigger value="aging">
            <BarChart3 className="mr-1.5 size-4" />
            Aging
          </TabsTrigger>
        </TabsList>

        {/* ---- Tab: Pendientes ---- */}
        <TabsContent value="pendientes">
          <Card>
            <CardHeader>
              <CardTitle>Facturas pendientes de cobro</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              ) : pending.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No hay facturas pendientes de cobro.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Factura</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                      <TableHead>Vencimiento</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pending.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell>{inv.partner || "-"}</TableCell>
                        <TableCell className="font-medium">{inv.name}</TableCell>
                        <TableCell className="text-right font-mono">
                          {formatMXN(
                            inv.amount_residual ?? inv.amount_total ?? inv.amount ?? 0
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(inv.invoice_date_due || inv.due_date)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setLinkDialogOpen(true)}
                          >
                            <Link2 className="mr-1.5 size-3.5" />
                            Link de pago
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Tab: Vencidas ---- */}
        <TabsContent value="vencidas">
          <Card>
            <CardHeader>
              <CardTitle>Facturas vencidas</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              ) : overdue.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No hay facturas vencidas.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Factura</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                      <TableHead>Vencimiento</TableHead>
                      <TableHead>Dias vencida</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overdue.map((inv) => {
                      const days = daysOverdue(inv.invoice_date_due || inv.due_date);
                      return (
                        <TableRow key={inv.id}>
                          <TableCell>{inv.partner || "-"}</TableCell>
                          <TableCell className="font-medium">{inv.name}</TableCell>
                          <TableCell className="text-right font-mono">
                            {formatMXN(
                              inv.amount_residual ?? inv.amount_total ?? inv.amount ?? 0
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDate(inv.invoice_date_due || inv.due_date)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                days > 60
                                  ? "destructive"
                                  : days > 30
                                    ? "outline"
                                    : "secondary"
                              }
                            >
                              {days} dias
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setLinkDialogOpen(true)}
                            >
                              <Link2 className="mr-1.5 size-3.5" />
                              Link de pago
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Tab: Aging ---- */}
        <TabsContent value="aging">
          <Card>
            <CardHeader>
              <CardTitle>Resumen de antiguedad de saldos</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              ) : aging.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No hay datos de aging disponibles.
                </p>
              ) : (
                <div className="grid gap-4">
                  {/* Summary cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {aging.map((bucket) => (
                      <Card key={bucket.bucket}>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm font-medium text-muted-foreground">
                            {bucket.bucket}
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="text-2xl font-bold">
                            {formatMXN(bucket.total)}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {bucket.count} factura{bucket.count !== 1 ? "s" : ""}
                          </p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {/* Aging table */}
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Periodo</TableHead>
                        <TableHead className="text-right">Facturas</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {aging.map((bucket) => (
                        <TableRow key={bucket.bucket}>
                          <TableCell className="font-medium">
                            {bucket.bucket}
                          </TableCell>
                          <TableCell className="text-right">
                            {bucket.count}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatMXN(bucket.total)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Payment Link Dialog */}
      <PaymentLinkDialog
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
      />
    </div>
  );
}
