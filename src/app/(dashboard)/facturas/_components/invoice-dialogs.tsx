"use client";

import { useState, useCallback } from "react";
import {
  FileText,
  XCircle,
  ShieldCheck,
  Receipt,
  Loader2,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { invoiceKeys } from "@/lib/hooks/use-invoices";
import { api } from "@/lib/api";
import { formatMoney, formatDate } from "@/lib/utils/format";
import { CANCELLATION_MOTIVOS } from "@/lib/utils/constants";
import type { Invoice } from "@/types";

import { StatusBadge } from "@/components/shared/status-badge";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";

import { truncateUuid, SatSemaphore } from "./columns";

/* ---------- Bulk Validation Result ---------- */

export interface BulkValidationResult {
  uuid: string;
  invoiceName: string;
  previousStatus: string;
  newStatus: string;
  changed: boolean;
  efosStatus?: string;
}

/* ---------- XML Viewer Dialog ---------- */

export function XmlViewerDialog({
  open,
  onOpenChange,
  invoiceId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string | null;
}) {
  const [xml, setXml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadXml = useCallback(async () => {
    if (!invoiceId) return;
    setLoading(true);
    try {
      const data = await api.invoices.cfdi(invoiceId);
      setXml(data.xml || data.xml_content || "No se encontro contenido XML");
    } catch (err: unknown) {
      toast.error((err instanceof Error ? err.message : null) || "Error al cargar XML");
      setXml(null);
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  if (open && xml === null && !loading) {
    loadXml();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setXml(null);
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-5" />
            XML del CFDI
          </DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : xml ? (
          <ScrollArea className="h-[60vh]">
            <pre className="whitespace-pre-wrap break-all rounded bg-muted p-4 text-xs font-mono">
              {xml}
            </pre>
          </ScrollArea>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No se encontro contenido XML.
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (xml) {
                navigator.clipboard.writeText(xml);
                toast.success("XML copiado al portapapeles");
              }
            }}
          >
            <Copy className="mr-1.5 size-3.5" />
            Copiar XML
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Cancellation Dialog ---------- */

export function CancellationDialog({
  open,
  onOpenChange,
  invoice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: Invoice | null;
}) {
  const [motivo, setMotivo] = useState("");
  const [uuidSustituto, setUuidSustituto] = useState("");
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();

  const handleSubmit = async () => {
    if (!invoice || !motivo) return;
    setLoading(true);
    try {
      await api.sat.cancel({
        invoice_id: invoice.id,
        cfdi_uuid: invoice.cfdi_uuid || invoice.odoo_cfdi_uuid,
        motivo,
        uuid_sustitucion: motivo === "01" ? uuidSustituto : undefined,
      });
      toast.success("Solicitud de cancelacion enviada");
      queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error((err instanceof Error ? err.message : null) || "Error al solicitar cancelacion");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XCircle className="size-5 text-destructive" />
            Solicitar Cancelacion
          </DialogTitle>
          <DialogDescription>
            Cancelar CFDI: {invoice?.cfdi_uuid || invoice?.odoo_cfdi_uuid || invoice?.name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Motivo de cancelacion</Label>
            <Select value={motivo} onValueChange={setMotivo}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona un motivo" />
              </SelectTrigger>
              <SelectContent>
                {CANCELLATION_MOTIVOS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {motivo === "01" && (
            <div className="space-y-2">
              <Label>UUID del CFDI que sustituye</Label>
              <Input
                value={uuidSustituto}
                onChange={(e) => setUuidSustituto(e.target.value)}
                placeholder="Ej: 6fd3b2a4-1c2e-..."
                className="font-mono text-sm"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={loading || !motivo || (motivo === "01" && !uuidSustituto)}
          >
            {loading && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Solicitar Cancelacion
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Bulk Validation Dialog ---------- */

export function BulkValidationDialog({
  open,
  onOpenChange,
  results,
  progress,
  total,
  isRunning,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  results: BulkValidationResult[];
  progress: number;
  total: number;
  isRunning: boolean;
}) {
  const [onlyChanges, setOnlyChanges] = useState(false);

  const filteredResults = onlyChanges ? results.filter((r) => r.changed) : results;

  return (
    <Dialog open={open} onOpenChange={isRunning ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5" />
            {isRunning ? "Validando contra el SAT..." : "Resultados de Validacion"}
          </DialogTitle>
        </DialogHeader>

        {isRunning ? (
          <div className="space-y-4 py-6">
            <div className="text-center text-sm text-muted-foreground">
              Validando {progress}/{total}...
            </div>
            <Progress value={total > 0 ? (progress / total) * 100 : 0} className="w-full" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {results.length} facturas validadas, {results.filter((r) => r.changed).length} con cambios
              </span>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="only-changes"
                  checked={onlyChanges}
                  onCheckedChange={(v) => setOnlyChanges(v === true)}
                />
                <Label htmlFor="only-changes" className="text-sm cursor-pointer">
                  Solo mostrar cambios
                </Label>
              </div>
            </div>

            <ScrollArea className="h-[50vh]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4">UUID</th>
                    <th className="pb-2 pr-4">Estado Anterior</th>
                    <th className="pb-2 pr-4">Estado Nuevo</th>
                    <th className="pb-2 pr-4">Cambio?</th>
                    <th className="pb-2">Semaforo</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredResults.map((r, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono text-xs">
                        {truncateUuid(r.uuid, 12)}
                      </td>
                      <td className="py-2 pr-4">
                        <StatusBadge status={r.previousStatus || "no_validado"} />
                      </td>
                      <td className="py-2 pr-4">
                        <StatusBadge status={r.newStatus || "no_validado"} />
                      </td>
                      <td className="py-2 pr-4">
                        {r.changed ? (
                          <Badge variant="default" className="bg-amber-500">Si</Badge>
                        ) : (
                          <Badge variant="secondary">No</Badge>
                        )}
                      </td>
                      <td className="py-2">
                        <SatSemaphore satStatus={r.newStatus} efosStatus={r.efosStatus} />
                      </td>
                    </tr>
                  ))}
                  {filteredResults.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-muted-foreground">
                        {onlyChanges ? "No hubo cambios en la validacion." : "Sin resultados."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </ScrollArea>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Complements Dialog ---------- */

export function ComplementsDialog({
  open,
  onOpenChange,
  invoice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: Invoice | null;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [complements, setComplements] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!invoice) return;
    setLoading(true);
    try {
      const data = await api.invoices.cfdi(invoice.id);
      const comps = data.complementos || data.complemento_pago || [];
      setComplements(Array.isArray(comps) ? comps : [comps].filter(Boolean));
    } catch (err: unknown) {
      toast.error((err instanceof Error ? err.message : null) || "Error al cargar complementos");
      setComplements([]);
    } finally {
      setLoading(false);
    }
  }, [invoice]);

  if (open && complements === null && !loading) {
    load();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setComplements(null);
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="size-5" />
            Complementos de Pago
          </DialogTitle>
          <DialogDescription>
            Factura: {invoice?.name}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : complements && complements.length > 0 ? (
          <ScrollArea className="max-h-[50vh]">
            <div className="space-y-3">
              {complements.map((comp, i) => (
                <div key={i} className="rounded border p-3 text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="font-medium">Complemento #{i + 1}</span>
                    {comp.uuid && (
                      <span className="font-mono text-xs text-muted-foreground">
                        {truncateUuid(comp.uuid, 12)}
                      </span>
                    )}
                  </div>
                  {comp.fecha_pago && <div>Fecha: {formatDate(comp.fecha_pago)}</div>}
                  {comp.monto != null && <div>Monto: {formatMoney(comp.monto)}</div>}
                  {comp.forma_pago && <div>Forma pago: {comp.forma_pago}</div>}
                  {comp.moneda && <div>Moneda: {comp.moneda}</div>}
                </div>
              ))}
            </div>
          </ScrollArea>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No se encontraron complementos de pago.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
