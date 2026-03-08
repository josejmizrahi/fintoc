"use client";

import { useState, useMemo, useCallback } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import {
  GitCompareArrows,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  DollarSign,
  Loader2,
  Import,
  RefreshCw,
  Eye,
  Ban,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";

import { useSatOdooReconciliation } from "@/lib/hooks/use-reconciliation";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { KpiCard } from "@/components/shared/kpi-card";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable } from "@/components/shared/data-table";
import { formatMoney, formatDate } from "@/lib/utils/format";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

import type { ReconciliationRecord, SatOdooResult, ConfirmDialogState } from "./types";
import { getPeriodDates, SAT_ODOO_STEPS } from "./types";
import { PeriodSelector } from "./period-selector";
import { ProcessingOverlay, AllReconciledBanner } from "./processing-overlay";
import { useProcessingProgress } from "./use-processing-progress";

export function SatOdooTab() {
  const satOdooMutation = useSatOdooReconciliation();
  const [satOdooPreset, setSatOdooPreset] = useState("current_month");
  const [satOdooCustomStart, setSatOdooCustomStart] = useState("");
  const [satOdooCustomEnd, setSatOdooCustomEnd] = useState("");
  const [satOdooResult, setSatOdooResult] = useState<SatOdooResult | null>(null);
  const satOdooProgress = useProcessingProgress(SAT_ODOO_STEPS);

  /* Confirm dialog state */
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    open: false,
    title: "",
    description: "",
    onConfirm: () => {},
  });

  const handleSatOdooStart = useCallback(() => {
    const period =
      satOdooPreset === "custom"
        ? { period_start: satOdooCustomStart, period_end: satOdooCustomEnd }
        : getPeriodDates(satOdooPreset);

    if (!period.period_start || !period.period_end) {
      toast.error("Selecciona un periodo valido");
      return;
    }

    const cleanup = satOdooProgress.start();
    satOdooMutation.mutate(period, {
      onSuccess: (data: SatOdooResult) => {
        setSatOdooResult(data);
        satOdooProgress.stop();
      },
      onError: () => {
        satOdooProgress.stop();
        cleanup?.();
      },
    });
  }, [satOdooPreset, satOdooCustomStart, satOdooCustomEnd, satOdooMutation, satOdooProgress]);

  /* SAT-Odoo: totals */
  const satOdooTotals = useMemo(() => {
    if (!satOdooResult) return null;
    return {
      matched: satOdooResult.matched?.length ?? 0,
      inSatNotOdoo: satOdooResult.in_sat_not_odoo?.length ?? 0,
      inOdooNotSat: satOdooResult.in_odoo_not_sat?.length ?? 0,
      amountDiff: satOdooResult.amount_differences?.length ?? 0,
    };
  }, [satOdooResult]);

  const satOdooAllReconciled = satOdooTotals
    ? satOdooTotals.inSatNotOdoo === 0 &&
      satOdooTotals.inOdooNotSat === 0 &&
      satOdooTotals.amountDiff === 0
    : false;

  /* ---------- Column Definitions ---------- */

  // SAT-Odoo: Matched
  const matchedColumns: ColumnDef<ReconciliationRecord, unknown>[] = useMemo(
    () => [
      { accessorKey: "uuid", header: "UUID", cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.uuid}</span>
      )},
      { accessorKey: "rfc_emisor", header: "RFC Emisor" },
      { accessorKey: "fecha", header: "Fecha", cell: ({ row }) => (
        row.original.fecha ? formatDate(row.original.fecha) : "-"
      )},
      { accessorKey: "monto", header: "Monto", cell: ({ row }) => (
        <span className="font-mono">{formatMoney(row.original.monto ?? 0)}</span>
      )},
      { id: "status", header: "Estado", cell: () => (
        <StatusBadge status="matched" />
      )},
    ],
    []
  );

  // SAT-Odoo: In SAT not Odoo
  const inSatNotOdooColumns: ColumnDef<ReconciliationRecord, unknown>[] = useMemo(
    () => [
      { accessorKey: "uuid", header: "UUID", cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.uuid}</span>
      )},
      { accessorKey: "rfc_emisor", header: "RFC Emisor" },
      { accessorKey: "rfc_receptor", header: "RFC Receptor" },
      { accessorKey: "fecha", header: "Fecha", cell: ({ row }) => (
        row.original.fecha ? formatDate(row.original.fecha) : "-"
      )},
      { accessorKey: "monto", header: "Monto", cell: ({ row }) => (
        <span className="font-mono">{formatMoney(row.original.monto ?? 0)}</span>
      )},
      { id: "actions", header: "Acciones", cell: ({ row }) => (
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            setConfirmDialog({
              open: true,
              title: "Importar a Odoo",
              description: `Se importara el CFDI ${row.original.uuid} a Odoo. ¿Deseas continuar?`,
              onConfirm: () => {
                toast.success(`CFDI ${row.original.uuid} enviado a importar`);
                setConfirmDialog((prev) => ({ ...prev, open: false }));
              },
            })
          }
        >
          <Import className="mr-1.5 size-3.5" />
          Importar a Odoo
        </Button>
      )},
    ],
    []
  );

  // SAT-Odoo: In Odoo not SAT
  const inOdooNotSatColumns: ColumnDef<ReconciliationRecord, unknown>[] = useMemo(
    () => [
      { accessorKey: "odoo_ref", header: "Ref. Odoo" },
      { accessorKey: "partner", header: "Socio" },
      { accessorKey: "fecha", header: "Fecha", cell: ({ row }) => (
        row.original.fecha ? formatDate(row.original.fecha) : "-"
      )},
      { accessorKey: "monto", header: "Monto", cell: ({ row }) => (
        <span className="font-mono">{formatMoney(row.original.monto ?? 0)}</span>
      )},
      { id: "actions", header: "Acciones", cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setConfirmDialog({
                open: true,
                title: "Re-timbrar factura",
                description: `Se re-timbrara la factura ${row.original.odoo_ref}. ¿Deseas continuar?`,
                onConfirm: () => {
                  toast.success(`Factura ${row.original.odoo_ref} enviada a re-timbrar`);
                  setConfirmDialog((prev) => ({ ...prev, open: false }));
                },
              })
            }
          >
            <RefreshCw className="mr-1 size-3.5" />
            Re-timbrar
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setConfirmDialog({
                open: true,
                title: "Verificar en SAT",
                description: `Se verificara la factura ${row.original.odoo_ref} en el SAT. ¿Deseas continuar?`,
                onConfirm: () => {
                  toast.success(`Verificacion de ${row.original.odoo_ref} iniciada`);
                  setConfirmDialog((prev) => ({ ...prev, open: false }));
                },
              })
            }
          >
            <Eye className="mr-1 size-3.5" />
            Verificar en SAT
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setConfirmDialog({
                open: true,
                title: "Ignorar discrepancia",
                description: `Se marcara la factura ${row.original.odoo_ref} como ignorada. ¿Deseas continuar?`,
                variant: "destructive",
                onConfirm: () => {
                  toast.success(`Factura ${row.original.odoo_ref} ignorada`);
                  setConfirmDialog((prev) => ({ ...prev, open: false }));
                },
              })
            }
          >
            <Ban className="mr-1 size-3.5" />
            Ignorar
          </Button>
        </div>
      )},
    ],
    []
  );

  // SAT-Odoo: Amount differences
  const amountDiffColumns: ColumnDef<ReconciliationRecord, unknown>[] = useMemo(
    () => [
      { accessorKey: "uuid", header: "UUID", cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.uuid}</span>
      )},
      { accessorKey: "monto_sat", header: "Monto SAT", cell: ({ row }) => (
        <span className="font-mono">{formatMoney(row.original.monto_sat ?? 0)}</span>
      )},
      { accessorKey: "monto_odoo", header: "Monto Odoo", cell: ({ row }) => (
        <span className="font-mono">{formatMoney(row.original.monto_odoo ?? 0)}</span>
      )},
      { id: "diferencia", header: "Diferencia", cell: ({ row }) => {
        const diff = (row.original.monto_sat ?? 0) - (row.original.monto_odoo ?? 0);
        return (
          <span className={`font-mono font-semibold ${diff > 0 ? "text-red-600" : "text-orange-600"}`}>
            {formatMoney(Math.abs(diff))}
          </span>
        );
      }},
      { id: "actions", header: "Acciones", cell: ({ row }) => (
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            setConfirmDialog({
              open: true,
              title: "Corregir en Odoo",
              description: `Se ajustara el monto en Odoo para el CFDI ${row.original.uuid} al monto SAT de ${formatMoney(row.original.monto_sat ?? 0)}. ¿Deseas continuar?`,
              onConfirm: () => {
                toast.success(`Correccion de ${row.original.uuid} enviada a Odoo`);
                setConfirmDialog((prev) => ({ ...prev, open: false }));
              },
            })
          }
        >
          <Pencil className="mr-1.5 size-3.5" />
          Corregir en Odoo
        </Button>
      )},
    ],
    []
  );

  return (
    <div className="space-y-6">
      {/* Controls */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <PeriodSelector
              preset={satOdooPreset}
              onPresetChange={setSatOdooPreset}
              customStart={satOdooCustomStart}
              customEnd={satOdooCustomEnd}
              onCustomStartChange={setSatOdooCustomStart}
              onCustomEndChange={setSatOdooCustomEnd}
            />
            <Button
              onClick={handleSatOdooStart}
              disabled={satOdooMutation.isPending}
            >
              {satOdooMutation.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <GitCompareArrows className="mr-2 size-4" />
              )}
              Iniciar Conciliacion SAT-Odoo
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Processing */}
      {satOdooProgress.isProcessing && (
        <ProcessingOverlay
          progressPercent={satOdooProgress.progressPercent}
          currentLabel={satOdooProgress.currentLabel}
        />
      )}

      {/* Empty state */}
      {!satOdooResult && !satOdooProgress.isProcessing && (
        <EmptyState
          icon={GitCompareArrows}
          title="Sin resultados de conciliacion"
          description="Ejecuta una conciliacion para detectar discrepancias entre SAT y Odoo."
        />
      )}

      {/* All reconciled banner */}
      {satOdooResult && satOdooAllReconciled && !satOdooProgress.isProcessing && (
        <AllReconciledBanner lastRun={satOdooResult.last_run} />
      )}

      {/* Results */}
      {satOdooResult && satOdooTotals && !satOdooProgress.isProcessing && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              title="Conciliados"
              value={satOdooTotals.matched}
              icon={CheckCircle2}
              description="CFDIs presentes en SAT y Odoo"
              className="border-green-200 dark:border-green-800"
            />
            <KpiCard
              title="En SAT, no en Odoo"
              value={satOdooTotals.inSatNotOdoo}
              icon={XCircle}
              description="CFDIs en SAT sin registro en Odoo"
              destructive={satOdooTotals.inSatNotOdoo > 0}
            />
            <KpiCard
              title="En Odoo, no en SAT"
              value={satOdooTotals.inOdooNotSat}
              icon={AlertTriangle}
              description="Facturas en Odoo sin UUID en SAT"
              className={satOdooTotals.inOdooNotSat > 0 ? "border-orange-200 dark:border-orange-800" : ""}
            />
            <KpiCard
              title="Diferencia de monto"
              value={satOdooTotals.amountDiff}
              icon={DollarSign}
              description="UUID coincide pero monto difiere"
              className={satOdooTotals.amountDiff > 0 ? "border-yellow-200 dark:border-yellow-800" : ""}
            />
          </div>

          {/* Expandable sections */}
          <Accordion type="multiple" className="space-y-2">
            <AccordionItem value="matched" className="rounded-lg border px-4">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">
                    {satOdooTotals.matched}
                  </Badge>
                  Conciliados
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <DataTable
                  columns={matchedColumns}
                  data={satOdooResult.matched ?? []}
                  emptyState="No hay registros conciliados."
                />
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="in-sat-not-odoo" className="rounded-lg border px-4">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <Badge variant="destructive">{satOdooTotals.inSatNotOdoo}</Badge>
                  En SAT, no en Odoo
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <DataTable
                  columns={inSatNotOdooColumns}
                  data={satOdooResult.in_sat_not_odoo ?? []}
                  emptyState="No hay discrepancias en esta categoria."
                />
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="in-odoo-not-sat" className="rounded-lg border px-4">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300">
                    {satOdooTotals.inOdooNotSat}
                  </Badge>
                  En Odoo, no en SAT
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <DataTable
                  columns={inOdooNotSatColumns}
                  data={satOdooResult.in_odoo_not_sat ?? []}
                  emptyState="No hay discrepancias en esta categoria."
                />
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="amount-diff" className="rounded-lg border px-4">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300">
                    {satOdooTotals.amountDiff}
                  </Badge>
                  Diferencia de monto
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <DataTable
                  columns={amountDiffColumns}
                  data={satOdooResult.amount_differences ?? []}
                  emptyState="No hay diferencias de monto."
                />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </>
      )}

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog((prev) => ({ ...prev, open }))}
        title={confirmDialog.title}
        description={confirmDialog.description}
        variant={confirmDialog.variant}
        onConfirm={confirmDialog.onConfirm}
      />
    </div>
  );
}
