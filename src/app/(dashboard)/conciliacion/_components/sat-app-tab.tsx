"use client";

import { useState, useMemo, useCallback } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import {
  GitCompareArrows,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Import,
  Eye,
  Ban,
} from "lucide-react";
import { toast } from "sonner";

import { useSatAppReconciliation, useImportToOdoo, useValidateCfdi } from "@/lib/hooks/use-reconciliation";
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

import type { ReconciliationRecord, SatAppResult, ConfirmDialogState } from "./types";
import { getPeriodDates, SAT_APP_STEPS } from "./types";
import { PeriodSelector } from "./period-selector";
import { ProcessingOverlay, AllReconciledBanner } from "./processing-overlay";
import { useProcessingProgress } from "./use-processing-progress";

export function SatAppTab() {
  const satAppMutation = useSatAppReconciliation();
  const importToOdoo = useImportToOdoo();
  const validateCfdi = useValidateCfdi();
  const [satAppPreset, setSatAppPreset] = useState("current_month");
  const [satAppCustomStart, setSatAppCustomStart] = useState("");
  const [satAppCustomEnd, setSatAppCustomEnd] = useState("");
  const [satAppResult, setSatAppResult] = useState<SatAppResult | null>(null);
  const satAppProgress = useProcessingProgress(SAT_APP_STEPS);

  /* Confirm dialog state */
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    open: false,
    title: "",
    description: "",
    onConfirm: () => {},
  });

  const handleSatAppStart = useCallback(() => {
    const period =
      satAppPreset === "custom"
        ? { period_start: satAppCustomStart, period_end: satAppCustomEnd }
        : getPeriodDates(satAppPreset);

    if (!period.period_start || !period.period_end) {
      toast.error("Selecciona un periodo valido");
      return;
    }

    const cleanup = satAppProgress.start();
    satAppMutation.mutate(period, {
      onSuccess: (data: SatAppResult) => {
        setSatAppResult(data);
        satAppProgress.stop();
        cleanup?.();
      },
      onError: () => {
        satAppProgress.stop();
        cleanup?.();
      },
    });
  }, [satAppPreset, satAppCustomStart, satAppCustomEnd, satAppMutation, satAppProgress]);

  const satAppTotals = useMemo(() => {
    if (!satAppResult) return null;
    return {
      matched: satAppResult.matched?.length ?? 0,
      inSatOnly: satAppResult.in_sat_only?.length ?? 0,
      inAppOnly: satAppResult.in_app_only?.length ?? 0,
    };
  }, [satAppResult]);

  const satAppAllReconciled = satAppTotals
    ? satAppTotals.inSatOnly === 0 && satAppTotals.inAppOnly === 0
    : false;

  /* ---------- Column Definitions ---------- */

  // SAT-App: matched
  const satAppMatchedColumns: ColumnDef<ReconciliationRecord, unknown>[] = useMemo(
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

  // SAT-App: SAT only
  const satAppSatOnlyColumns: ColumnDef<ReconciliationRecord, unknown>[] = useMemo(
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
          disabled={importToOdoo.isPending}
          onClick={() =>
            setConfirmDialog({
              open: true,
              title: "Importar a la App",
              description: `Se importara el CFDI ${row.original.uuid} a la aplicacion. ¿Deseas continuar?`,
              onConfirm: () => {
                importToOdoo.mutate({ cfdi_uuid: row.original.uuid ?? '' });
                setConfirmDialog((prev) => ({ ...prev, open: false }));
              },
            })
          }
        >
          <Import className="mr-1.5 size-3.5" />
          Importar a App
        </Button>
      )},
    ],
    [importToOdoo]
  );

  // SAT-App: App only
  const satAppAppOnlyColumns: ColumnDef<ReconciliationRecord, unknown>[] = useMemo(
    () => [
      { accessorKey: "invoice_ref", header: "Ref. Factura" },
      { accessorKey: "partner", header: "Cliente" },
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
            disabled={validateCfdi.isPending}
            onClick={() =>
              setConfirmDialog({
                open: true,
                title: "Verificar en SAT",
                description: `Se verificara la factura ${row.original.invoice_ref} en el SAT. ¿Continuar?`,
                onConfirm: () => {
                  validateCfdi.mutate({ uuid: row.original.uuid ?? row.original.invoice_ref ?? '' });
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
                title: "Ignorar",
                description: `Se marcara la factura ${row.original.invoice_ref} como ignorada. ¿Continuar?`,
                variant: "destructive",
                onConfirm: () => {
                  toast.success(`Factura ${row.original.invoice_ref} ignorada`);
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
    [validateCfdi]
  );

  return (
    <div className="space-y-6">
      {/* Controls */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <PeriodSelector
              preset={satAppPreset}
              onPresetChange={setSatAppPreset}
              customStart={satAppCustomStart}
              customEnd={satAppCustomEnd}
              onCustomStartChange={setSatAppCustomStart}
              onCustomEndChange={setSatAppCustomEnd}
            />
            <Button
              onClick={handleSatAppStart}
              disabled={satAppMutation.isPending}
            >
              {satAppMutation.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <GitCompareArrows className="mr-2 size-4" />
              )}
              Iniciar Conciliacion SAT-App
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Processing */}
      {satAppProgress.isProcessing && (
        <ProcessingOverlay
          progressPercent={satAppProgress.progressPercent}
          currentLabel={satAppProgress.currentLabel}
        />
      )}

      {/* Empty state */}
      {!satAppResult && !satAppProgress.isProcessing && (
        <EmptyState
          icon={GitCompareArrows}
          title="Sin resultados de conciliacion"
          description="Ejecuta una conciliacion para detectar discrepancias entre SAT y la App."
        />
      )}

      {/* All reconciled banner */}
      {satAppResult && satAppAllReconciled && !satAppProgress.isProcessing && (
        <AllReconciledBanner lastRun={satAppResult.last_run} />
      )}

      {/* Results */}
      {satAppResult && satAppTotals && !satAppProgress.isProcessing && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <KpiCard
              title="Conciliados"
              value={satAppTotals.matched}
              icon={CheckCircle2}
              description="CFDIs presentes en SAT y App"
              className="border-green-200 dark:border-green-800"
            />
            <KpiCard
              title="Solo en SAT"
              value={satAppTotals.inSatOnly}
              icon={XCircle}
              description="CFDIs en SAT sin registro en App"
              destructive={satAppTotals.inSatOnly > 0}
            />
            <KpiCard
              title="Solo en App"
              value={satAppTotals.inAppOnly}
              icon={AlertTriangle}
              description="Facturas en App sin CFDI en SAT"
              className={satAppTotals.inAppOnly > 0 ? "border-orange-200 dark:border-orange-800" : ""}
            />
          </div>

          {/* Expandable sections */}
          <Accordion type="multiple" className="space-y-2">
            <AccordionItem value="sat-app-matched" className="rounded-lg border px-4">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">
                    {satAppTotals.matched}
                  </Badge>
                  Conciliados
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <DataTable
                  columns={satAppMatchedColumns}
                  data={satAppResult.matched ?? []}
                  emptyState="No hay registros conciliados."
                />
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="sat-app-sat-only" className="rounded-lg border px-4">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <Badge variant="destructive">{satAppTotals.inSatOnly}</Badge>
                  Solo en SAT
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <DataTable
                  columns={satAppSatOnlyColumns}
                  data={satAppResult.in_sat_only ?? []}
                  emptyState="No hay discrepancias en esta categoria."
                />
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="sat-app-app-only" className="rounded-lg border px-4">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300">
                    {satAppTotals.inAppOnly}
                  </Badge>
                  Solo en App
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <DataTable
                  columns={satAppAppOnlyColumns}
                  data={satAppResult.in_app_only ?? []}
                  emptyState="No hay discrepancias en esta categoria."
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
