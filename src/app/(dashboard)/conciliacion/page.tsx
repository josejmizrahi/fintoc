"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import {
  Loader2,
  GitCompareArrows,
  ShieldCheck,
  History,
  CheckCircle2,
  XCircle,
  AlertTriangle,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
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
    hour: "2-digit",
    minute: "2-digit",
  });
}

function reconciliationStatusBadge(status: string) {
  const normalized = status?.toLowerCase() || "";
  if (normalized === "matched" || normalized === "conciliado") {
    return (
      <Badge variant="default" className="bg-green-600 hover:bg-green-700 text-white">
        <CheckCircle2 className="mr-1 size-3" />
        Conciliado
      </Badge>
    );
  }
  if (normalized === "unmatched" || normalized === "no conciliado") {
    return (
      <Badge variant="destructive">
        <XCircle className="mr-1 size-3" />
        No conciliado
      </Badge>
    );
  }
  if (normalized === "partial" || normalized === "parcial") {
    return (
      <Badge variant="secondary" className="bg-yellow-500 hover:bg-yellow-600 text-white">
        <AlertTriangle className="mr-1 size-3" />
        Parcial
      </Badge>
    );
  }
  return <Badge variant="outline">{status || "Desconocido"}</Badge>;
}

/* ---------- Main Page ---------- */

export default function ConciliacionPage() {
  /* ---- Fintoc vs Odoo state ---- */
  const [fintocDays, setFintocDays] = useState("7");
  const [fintocLoading, setFintocLoading] = useState(false);
  const [fintocResults, setFintocResults] = useState<any | null>(null);

  /* ---- SAT reconciliation state ---- */
  const [satDays, setSatDays] = useState("7");
  const [satLoading, setSatLoading] = useState(false);
  const [satResults, setSatResults] = useState<any | null>(null);

  /* ---- History state ---- */
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  /* ---- Fetch history ---- */
  async function fetchHistory() {
    setHistoryLoading(true);
    try {
      const data = await api.reconciliation.history();
      setHistory(data);
    } catch (err: any) {
      toast.error(err.message || "Error al cargar historial de conciliaciones");
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    fetchHistory();
  }, []);

  /* ---- Fintoc vs Odoo ---- */
  async function handleFintocOdoo() {
    setFintocLoading(true);
    setFintocResults(null);
    try {
      const result = await api.reconciliation.fintocOdoo(parseInt(fintocDays, 10));
      setFintocResults(result);
      toast.success("Conciliacion Fintoc vs Odoo completada");
      fetchHistory();
    } catch (err: any) {
      toast.error(err.message || "Error en conciliacion Fintoc vs Odoo");
    } finally {
      setFintocLoading(false);
    }
  }

  /* ---- SAT reconciliation ---- */
  async function handleSatReconciliation() {
    setSatLoading(true);
    setSatResults(null);
    try {
      const result = await api.reconciliation.sat(parseInt(satDays, 10));
      setSatResults(result);
      toast.success("Conciliacion SAT completada");
      fetchHistory();
    } catch (err: any) {
      toast.error(err.message || "Error en conciliacion SAT");
    } finally {
      setSatLoading(false);
    }
  }

  /* ---- Extract entries from result ---- */
  function getEntries(result: any): any[] {
    if (!result) return [];
    if (Array.isArray(result)) return result;
    if (Array.isArray(result.entries)) return result.entries;
    if (Array.isArray(result.results)) return result.results;
    if (Array.isArray(result.items)) return result.items;
    return [];
  }

  /* ---------- render ---------- */

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Conciliacion Bancaria</h1>
        <p className="text-muted-foreground text-sm">
          Concilia pagos entre Fintoc, Odoo y el SAT para detectar discrepancias.
        </p>
      </div>

      {/* Action Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Fintoc vs Odoo */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitCompareArrows className="size-5" />
              Fintoc vs Odoo
            </CardTitle>
            <CardDescription>
              Compara movimientos bancarios de Fintoc con pagos registrados en Odoo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Periodo (dias)</Label>
                <Select value={fintocDays} onValueChange={setFintocDays}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">Ultimos 7 dias</SelectItem>
                    <SelectItem value="14">Ultimos 14 dias</SelectItem>
                    <SelectItem value="30">Ultimos 30 dias</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleFintocOdoo} disabled={fintocLoading} className="w-full">
                {fintocLoading ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <GitCompareArrows className="mr-2 size-4" />
                )}
                Conciliar
              </Button>
            </div>

            {fintocResults && (
              <>
                <Separator className="my-4" />
                {/* Summary */}
                {fintocResults.summary && (
                  <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
                    <div className="text-center">
                      <p className="text-muted-foreground">Conciliados</p>
                      <p className="text-lg font-bold text-green-600">
                        {fintocResults.summary.matched ?? 0}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-muted-foreground">No conciliados</p>
                      <p className="text-lg font-bold text-red-600">
                        {fintocResults.summary.unmatched ?? 0}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-muted-foreground">Parciales</p>
                      <p className="text-lg font-bold text-yellow-600">
                        {fintocResults.summary.partial ?? 0}
                      </p>
                    </div>
                  </div>
                )}
                {/* Table */}
                {getEntries(fintocResults).length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Pago Odoo</TableHead>
                        <TableHead className="text-right">Monto Odoo</TableHead>
                        <TableHead className="text-right">Monto Fintoc</TableHead>
                        <TableHead className="text-right">Diferencia</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>CFDI UUID</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {getEntries(fintocResults).map((entry: any, idx: number) => (
                        <TableRow key={idx}>
                          <TableCell className="font-medium">
                            {entry.odoo_payment || "-"}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {entry.amount_odoo != null ? formatMXN(entry.amount_odoo) : "-"}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {entry.amount_fintoc != null ? formatMXN(entry.amount_fintoc) : "-"}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {entry.difference != null ? formatMXN(entry.difference) : "-"}
                          </TableCell>
                          <TableCell>
                            {reconciliationStatusBadge(entry.status || "")}
                          </TableCell>
                          <TableCell className="font-mono text-xs max-w-[150px] truncate">
                            {entry.cfdi_uuid || "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-center text-sm text-muted-foreground py-4">
                    Sin entradas de conciliacion.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* SAT */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-5" />
              SAT
            </CardTitle>
            <CardDescription>
              Valida los CFDI asociados a pagos contra el servicio del SAT.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Periodo (dias)</Label>
                <Select value={satDays} onValueChange={setSatDays}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">Ultimos 7 dias</SelectItem>
                    <SelectItem value="14">Ultimos 14 dias</SelectItem>
                    <SelectItem value="30">Ultimos 30 dias</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleSatReconciliation} disabled={satLoading} className="w-full">
                {satLoading ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <ShieldCheck className="mr-2 size-4" />
                )}
                Conciliar SAT
              </Button>
            </div>

            {satResults && (
              <>
                <Separator className="my-4" />
                {/* Summary */}
                {satResults.summary && (
                  <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
                    <div className="text-center">
                      <p className="text-muted-foreground">Conciliados</p>
                      <p className="text-lg font-bold text-green-600">
                        {satResults.summary.matched ?? 0}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-muted-foreground">No conciliados</p>
                      <p className="text-lg font-bold text-red-600">
                        {satResults.summary.unmatched ?? 0}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-muted-foreground">Parciales</p>
                      <p className="text-lg font-bold text-yellow-600">
                        {satResults.summary.partial ?? 0}
                      </p>
                    </div>
                  </div>
                )}
                {/* Table */}
                {getEntries(satResults).length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Pago Odoo</TableHead>
                        <TableHead className="text-right">Monto Odoo</TableHead>
                        <TableHead className="text-right">Monto Fintoc</TableHead>
                        <TableHead className="text-right">Diferencia</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>CFDI UUID</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {getEntries(satResults).map((entry: any, idx: number) => (
                        <TableRow key={idx}>
                          <TableCell className="font-medium">
                            {entry.odoo_payment || "-"}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {entry.amount_odoo != null ? formatMXN(entry.amount_odoo) : "-"}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {entry.amount_fintoc != null ? formatMXN(entry.amount_fintoc) : "-"}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {entry.difference != null ? formatMXN(entry.difference) : "-"}
                          </TableCell>
                          <TableCell>
                            {reconciliationStatusBadge(entry.status || "")}
                          </TableCell>
                          <TableCell className="font-mono text-xs max-w-[150px] truncate">
                            {entry.cfdi_uuid || "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-center text-sm text-muted-foreground py-4">
                    Sin entradas de conciliacion.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* History Section */}
      <Separator />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="size-5" />
            Historial de Conciliaciones
          </CardTitle>
          <CardDescription>
            Registro de conciliaciones realizadas anteriormente.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : history.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No hay conciliaciones previas registradas.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Periodo</TableHead>
                  <TableHead>Conciliados</TableHead>
                  <TableHead>No conciliados</TableHead>
                  <TableHead>Diferencia Total</TableHead>
                  <TableHead>Fecha</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((item, idx) => (
                  <TableRow key={item.id ?? idx}>
                    <TableCell className="font-medium">
                      #{item.id ?? idx + 1}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {item.type || item.reconciliation_type || "-"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {item.days ? `${item.days} dias` : item.period || "-"}
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-green-600">
                        {item.matched ?? item.conciliados ?? "-"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-red-600">
                        {item.unmatched ?? item.no_conciliados ?? "-"}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono">
                      {item.total_difference != null
                        ? formatMXN(item.total_difference)
                        : "-"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(item.created_at || item.date)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
