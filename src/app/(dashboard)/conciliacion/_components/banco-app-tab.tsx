"use client";

import { useState, useMemo, useCallback } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import {
  GitCompareArrows,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  FileSearch,
  Link2,
} from "lucide-react";
import { toast } from "sonner";

import { useBancoAppReconciliation } from "@/lib/hooks/use-reconciliation";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

import type { ReconciliationRecord, BancoAppResult, ConfirmDialogState } from "./types";
import { getPeriodDates, BANCO_APP_STEPS } from "./types";
import { PeriodSelector } from "./period-selector";
import { ProcessingOverlay, AllReconciledBanner } from "./processing-overlay";
import { useProcessingProgress } from "./use-processing-progress";

export function BancoAppTab() {
  const bancoAppMutation = useBancoAppReconciliation();
  const [bancoAppPreset, setBancoAppPreset] = useState("current_month");
  const [bancoAppCustomStart, setBancoAppCustomStart] = useState("");
  const [bancoAppCustomEnd, setBancoAppCustomEnd] = useState("");
  const [bancoAppResult, setBancoAppResult] = useState<BancoAppResult | null>(null);
  const bancoAppProgress = useProcessingProgress(BANCO_APP_STEPS);

  /* Manual match combobox state */
  const [manualMatchId, setManualMatchId] = useState<string | null>(null);
  const [manualMatchTarget, setManualMatchTarget] = useState("");

  /* Confirm dialog state */
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    open: false,
    title: "",
    description: "",
    onConfirm: () => {},
  });

  const handleBancoAppStart = useCallback(() => {
    const period =
      bancoAppPreset === "custom"
        ? { period_start: bancoAppCustomStart, period_end: bancoAppCustomEnd }
        : getPeriodDates(bancoAppPreset);

    if (!period.period_start || !period.period_end) {
      toast.error("Selecciona un periodo valido");
      return;
    }

    const cleanup = bancoAppProgress.start();
    bancoAppMutation.mutate(period, {
      onSuccess: (data: BancoAppResult) => {
        setBancoAppResult(data);
        bancoAppProgress.stop();
      },
      onError: () => {
        bancoAppProgress.stop();
        cleanup?.();
      },
    });
  }, [bancoAppPreset, bancoAppCustomStart, bancoAppCustomEnd, bancoAppMutation, bancoAppProgress]);

  const bancoAppTotals = useMemo(() => {
    if (!bancoAppResult) return null;
    return {
      matched: bancoAppResult.matched?.length ?? 0,
      inBancoOnly: bancoAppResult.in_banco_only?.length ?? 0,
      inAppOnly: bancoAppResult.in_app_only?.length ?? 0,
    };
  }, [bancoAppResult]);

  const bancoAppAllReconciled = bancoAppTotals
    ? bancoAppTotals.inBancoOnly === 0 && bancoAppTotals.inAppOnly === 0
    : false;

  /* ---------- Column Definitions ---------- */

  // Banco-App: matched
  const bancoMatchedColumns: ColumnDef<ReconciliationRecord, unknown>[] = useMemo(
    () => [
      { accessorKey: "bank_ref", header: "Ref. Banco" },
      { accessorKey: "app_ref", header: "Ref. App" },
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

  // Banco-App: banco only
  const bancoBancoOnlyColumns: ColumnDef<ReconciliationRecord, unknown>[] = useMemo(
    () => [
      { accessorKey: "bank_ref", header: "Ref. Banco" },
      { accessorKey: "descripcion", header: "Descripcion" },
      { accessorKey: "fecha", header: "Fecha", cell: ({ row }) => (
        row.original.fecha ? formatDate(row.original.fecha) : "-"
      )},
      { accessorKey: "monto", header: "Monto", cell: ({ row }) => (
        <span className="font-mono">{formatMoney(row.original.monto ?? 0)}</span>
      )},
      { id: "actions", header: "Acciones", cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Select
            value={manualMatchId === row.original.id ? manualMatchTarget : ""}
            onValueChange={(val) => {
              setManualMatchId(row.original.id ?? null);
              setManualMatchTarget(val);
            }}
          >
            <SelectTrigger className="w-[180px] h-8 text-xs">
              <SelectValue placeholder="Seleccionar pago..." />
            </SelectTrigger>
            <SelectContent>
              {(bancoAppResult?.in_app_only ?? []).map((appItem: ReconciliationRecord) => (
                <SelectItem key={appItem.id ?? appItem.app_ref ?? ''} value={appItem.id ?? appItem.app_ref ?? ''}>
                  {appItem.app_ref} - {formatMoney(appItem.monto ?? 0)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            disabled={manualMatchId !== row.original.id || !manualMatchTarget}
            onClick={() =>
              setConfirmDialog({
                open: true,
                title: "Conciliar manualmente",
                description: `Se conciliara el movimiento bancario ${row.original.bank_ref} con el pago ${manualMatchTarget}. ¿Continuar?`,
                onConfirm: () => {
                  toast.success(`Conciliacion manual completada: ${row.original.bank_ref}`);
                  setManualMatchId(null);
                  setManualMatchTarget("");
                  setConfirmDialog((prev) => ({ ...prev, open: false }));
                },
              })
            }
          >
            <Link2 className="mr-1 size-3.5" />
            Conciliar Manualmente
          </Button>
        </div>
      )},
    ],
    [manualMatchId, manualMatchTarget, bancoAppResult]
  );

  // Banco-App: app only
  const bancoAppOnlyColumns: ColumnDef<ReconciliationRecord, unknown>[] = useMemo(
    () => [
      { accessorKey: "app_ref", header: "Ref. App" },
      { accessorKey: "partner", header: "Cliente/Proveedor" },
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
          className="text-red-600 border-red-200 hover:bg-red-50"
          onClick={() =>
            setConfirmDialog({
              open: true,
              title: "Investigar pago",
              description: `El pago ${row.original.app_ref} no tiene movimiento bancario asociado. ¿Deseas marcarlo para investigacion?`,
              variant: "destructive",
              onConfirm: () => {
                toast.success(`Pago ${row.original.app_ref} marcado para investigacion`);
                setConfirmDialog((prev) => ({ ...prev, open: false }));
              },
            })
          }
        >
          <FileSearch className="mr-1.5 size-3.5" />
          Investigar
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
              preset={bancoAppPreset}
              onPresetChange={setBancoAppPreset}
              customStart={bancoAppCustomStart}
              customEnd={bancoAppCustomEnd}
              onCustomStartChange={setBancoAppCustomStart}
              onCustomEndChange={setBancoAppCustomEnd}
            />
            <Button
              onClick={handleBancoAppStart}
              disabled={bancoAppMutation.isPending}
            >
              {bancoAppMutation.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <GitCompareArrows className="mr-2 size-4" />
              )}
              Iniciar Conciliacion Banco-App
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Processing */}
      {bancoAppProgress.isProcessing && (
        <ProcessingOverlay
          progressPercent={bancoAppProgress.progressPercent}
          currentLabel={bancoAppProgress.currentLabel}
        />
      )}

      {/* Empty state */}
      {!bancoAppResult && !bancoAppProgress.isProcessing && (
        <EmptyState
          icon={GitCompareArrows}
          title="Sin resultados de conciliacion"
          description="Ejecuta una conciliacion para detectar discrepancias entre el banco y la App."
        />
      )}

      {/* All reconciled banner */}
      {bancoAppResult && bancoAppAllReconciled && !bancoAppProgress.isProcessing && (
        <AllReconciledBanner lastRun={bancoAppResult.last_run} />
      )}

      {/* Results */}
      {bancoAppResult && bancoAppTotals && !bancoAppProgress.isProcessing && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <KpiCard
              title="Conciliados"
              value={bancoAppTotals.matched}
              icon={CheckCircle2}
              description="Movimientos bancarios con pago en App"
              className="border-green-200 dark:border-green-800"
            />
            <KpiCard
              title="Solo en Banco"
              value={bancoAppTotals.inBancoOnly}
              icon={AlertTriangle}
              description="Movimientos sin pago: categorizar"
              className={bancoAppTotals.inBancoOnly > 0 ? "border-yellow-200 dark:border-yellow-800" : ""}
            />
            <KpiCard
              title="Solo en App"
              value={bancoAppTotals.inAppOnly}
              icon={XCircle}
              description="Pagos sin movimiento: investigar"
              destructive={bancoAppTotals.inAppOnly > 0}
            />
          </div>

          {/* Expandable sections */}
          <Accordion type="multiple" className="space-y-2">
            <AccordionItem value="banco-app-matched" className="rounded-lg border px-4">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">
                    {bancoAppTotals.matched}
                  </Badge>
                  Conciliados
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <DataTable
                  columns={bancoMatchedColumns}
                  data={bancoAppResult.matched ?? []}
                  emptyState="No hay registros conciliados."
                />
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="banco-app-banco-only" className="rounded-lg border px-4">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300">
                    {bancoAppTotals.inBancoOnly}
                  </Badge>
                  Solo en Banco
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <DataTable
                  columns={bancoBancoOnlyColumns}
                  data={bancoAppResult.in_banco_only ?? []}
                  emptyState="No hay movimientos bancarios sin conciliar."
                />
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="banco-app-app-only" className="rounded-lg border px-4">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <Badge variant="destructive">{bancoAppTotals.inAppOnly}</Badge>
                  Solo en App
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <DataTable
                  columns={bancoAppOnlyColumns}
                  data={bancoAppResult.in_app_only ?? []}
                  emptyState="No hay pagos sin movimiento bancario."
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
