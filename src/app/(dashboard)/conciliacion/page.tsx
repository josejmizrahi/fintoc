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
  ShieldCheck,
  Landmark,
  FileSearch,
  Import,
  RefreshCw,
  Eye,
  Ban,
  Pencil,
  Link2,
} from "lucide-react";
import { toast } from "sonner";

import {
  useReconciliationHistory,
  useSatOdooReconciliation,
  useSatAppReconciliation,
  useBancoAppReconciliation,
} from "@/lib/hooks/use-reconciliation";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { KpiCard } from "@/components/shared/kpi-card";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable } from "@/components/shared/data-table";
import { formatMoney, formatDate, formatDateTime } from "@/lib/utils/format";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/* ---------- Types ---------- */

interface ReconciliationPeriod {
  period_start: string;
  period_end: string;
}

interface SatOdooResult {
  matched: any[];
  in_sat_not_odoo: any[];
  in_odoo_not_sat: any[];
  amount_differences: any[];
  last_run?: string;
}

interface SatAppResult {
  matched: any[];
  in_sat_only: any[];
  in_app_only: any[];
  last_run?: string;
}

interface BancoAppResult {
  matched: any[];
  in_banco_only: any[];
  in_app_only: any[];
  last_run?: string;
}

/* ---------- Period helpers ---------- */

function getPeriodDates(preset: string): ReconciliationPeriod {
  const now = new Date();
  const end = now.toISOString().split("T")[0];

  switch (preset) {
    case "current_month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { period_start: start.toISOString().split("T")[0], period_end: end };
    }
    case "previous_month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const endPrev = new Date(now.getFullYear(), now.getMonth(), 0);
      return {
        period_start: start.toISOString().split("T")[0],
        period_end: endPrev.toISOString().split("T")[0],
      };
    }
    case "quarter": {
      const start = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
      return { period_start: start.toISOString().split("T")[0], period_end: end };
    }
    case "semester": {
      const start = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
      return { period_start: start.toISOString().split("T")[0], period_end: end };
    }
    default:
      return { period_start: end, period_end: end };
  }
}

/* ---------- Processing steps ---------- */

const SAT_ODOO_STEPS = [
  "Descargando del SAT...",
  "Leyendo de Odoo...",
  "Comparando registros...",
  "Generando reporte...",
];

const SAT_APP_STEPS = [
  "Descargando del SAT...",
  "Leyendo facturas de la App...",
  "Comparando registros...",
  "Generando reporte...",
];

const BANCO_APP_STEPS = [
  "Obteniendo movimientos bancarios...",
  "Leyendo pagos de la App...",
  "Comparando registros...",
  "Generando reporte...",
];

/* ---------- Progress simulation hook ---------- */

function useProcessingProgress(steps: string[]) {
  const [step, setStep] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  const start = useCallback(() => {
    setStep(0);
    setIsProcessing(true);
    let current = 0;
    const interval = setInterval(() => {
      current += 1;
      if (current >= steps.length) {
        clearInterval(interval);
      } else {
        setStep(current);
      }
    }, 1200);
    return () => clearInterval(interval);
  }, [steps.length]);

  const stop = useCallback(() => {
    setIsProcessing(false);
    setStep(0);
  }, []);

  const progressPercent = isProcessing
    ? Math.min(((step + 1) / steps.length) * 100, 95)
    : 0;

  return {
    step,
    isProcessing,
    start,
    stop,
    progressPercent,
    currentLabel: steps[step] ?? "",
  };
}

/* ---------- Period Selector component ---------- */

function PeriodSelector({
  preset,
  onPresetChange,
  customStart,
  customEnd,
  onCustomStartChange,
  onCustomEndChange,
}: {
  preset: string;
  onPresetChange: (value: string) => void;
  customStart: string;
  customEnd: string;
  onCustomStartChange: (value: string) => void;
  onCustomEndChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="grid gap-1.5">
        <Label className="text-xs">Periodo</Label>
        <Select value={preset} onValueChange={onPresetChange}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Seleccionar periodo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="current_month">Mes actual</SelectItem>
            <SelectItem value="previous_month">Mes anterior</SelectItem>
            <SelectItem value="quarter">Ultimo trimestre</SelectItem>
            <SelectItem value="semester">Ultimo semestre</SelectItem>
            <SelectItem value="custom">Personalizado</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {preset === "custom" && (
        <>
          <div className="grid gap-1.5">
            <Label className="text-xs">Desde</Label>
            <Input
              type="date"
              value={customStart}
              onChange={(e) => onCustomStartChange(e.target.value)}
              className="w-[160px]"
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Hasta</Label>
            <Input
              type="date"
              value={customEnd}
              onChange={(e) => onCustomEndChange(e.target.value)}
              className="w-[160px]"
            />
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- All Reconciled Banner ---------- */

function AllReconciledBanner({ lastRun }: { lastRun?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950/30">
      <CheckCircle2 className="size-5 text-green-600 shrink-0" />
      <div>
        <p className="font-medium text-green-800 dark:text-green-300">
          Todo conciliado. 0 discrepancias.
        </p>
        {lastRun && (
          <p className="text-sm text-green-600 dark:text-green-400">
            Ultima ejecucion: {formatDateTime(lastRun)}
          </p>
        )}
      </div>
    </div>
  );
}

/* ---------- Processing overlay ---------- */

function ProcessingOverlay({
  progressPercent,
  currentLabel,
}: {
  progressPercent: number;
  currentLabel: string;
}) {
  return (
    <Card>
      <CardContent className="py-8">
        <div className="mx-auto max-w-md space-y-4">
          <div className="flex items-center justify-center gap-2 text-sm font-medium">
            <Loader2 className="size-4 animate-spin" />
            {currentLabel}
          </div>
          <Progress value={progressPercent} className="h-3" />
          <p className="text-center text-xs text-muted-foreground">
            {Math.round(progressPercent)}% completado
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/* ========== MAIN PAGE ========== */

export default function ConciliacionPage() {
  const [activeTab, setActiveTab] = useState("sat-odoo");

  /* ------ History ------ */
  const { data: history, isLoading: historyLoading } = useReconciliationHistory();

  /* ====== TAB 1: SAT - Odoo ====== */
  const satOdooMutation = useSatOdooReconciliation();
  const [satOdooPreset, setSatOdooPreset] = useState("current_month");
  const [satOdooCustomStart, setSatOdooCustomStart] = useState("");
  const [satOdooCustomEnd, setSatOdooCustomEnd] = useState("");
  const [satOdooResult, setSatOdooResult] = useState<SatOdooResult | null>(null);
  const satOdooProgress = useProcessingProgress(SAT_ODOO_STEPS);

  /* Confirm dialog state */
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    variant?: "default" | "destructive";
    onConfirm: () => void;
  }>({
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
      onSuccess: (data: any) => {
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

  /* ====== TAB 2: SAT - App ====== */
  const satAppMutation = useSatAppReconciliation();
  const [satAppPreset, setSatAppPreset] = useState("current_month");
  const [satAppCustomStart, setSatAppCustomStart] = useState("");
  const [satAppCustomEnd, setSatAppCustomEnd] = useState("");
  const [satAppResult, setSatAppResult] = useState<SatAppResult | null>(null);
  const satAppProgress = useProcessingProgress(SAT_APP_STEPS);

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
      onSuccess: (data: any) => {
        setSatAppResult(data);
        satAppProgress.stop();
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

  /* ====== TAB 3: Banco - App ====== */
  const bancoAppMutation = useBancoAppReconciliation();
  const [bancoAppPreset, setBancoAppPreset] = useState("current_month");
  const [bancoAppCustomStart, setBancoAppCustomStart] = useState("");
  const [bancoAppCustomEnd, setBancoAppCustomEnd] = useState("");
  const [bancoAppResult, setBancoAppResult] = useState<BancoAppResult | null>(null);
  const bancoAppProgress = useProcessingProgress(BANCO_APP_STEPS);

  /* Manual match combobox state */
  const [manualMatchId, setManualMatchId] = useState<string | null>(null);
  const [manualMatchTarget, setManualMatchTarget] = useState("");

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
      onSuccess: (data: any) => {
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

  // SAT-Odoo: Matched
  const matchedColumns: ColumnDef<any, any>[] = useMemo(
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
  const inSatNotOdooColumns: ColumnDef<any, any>[] = useMemo(
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
  const inOdooNotSatColumns: ColumnDef<any, any>[] = useMemo(
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
  const amountDiffColumns: ColumnDef<any, any>[] = useMemo(
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

  // SAT-App: matched
  const satAppMatchedColumns: ColumnDef<any, any>[] = useMemo(
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
  const satAppSatOnlyColumns: ColumnDef<any, any>[] = useMemo(
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
              title: "Importar a la App",
              description: `Se importara el CFDI ${row.original.uuid} a la aplicacion. ¿Deseas continuar?`,
              onConfirm: () => {
                toast.success(`CFDI ${row.original.uuid} enviado a importar`);
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
    []
  );

  // SAT-App: App only
  const satAppAppOnlyColumns: ColumnDef<any, any>[] = useMemo(
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
            onClick={() =>
              setConfirmDialog({
                open: true,
                title: "Verificar en SAT",
                description: `Se verificara la factura ${row.original.invoice_ref} en el SAT. ¿Continuar?`,
                onConfirm: () => {
                  toast.success(`Verificacion de ${row.original.invoice_ref} iniciada`);
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
    []
  );

  // Banco-App: matched
  const bancoMatchedColumns: ColumnDef<any, any>[] = useMemo(
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
  const bancoBancoOnlyColumns: ColumnDef<any, any>[] = useMemo(
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
              setManualMatchId(row.original.id);
              setManualMatchTarget(val);
            }}
          >
            <SelectTrigger className="w-[180px] h-8 text-xs">
              <SelectValue placeholder="Seleccionar pago..." />
            </SelectTrigger>
            <SelectContent>
              {(bancoAppResult?.in_app_only ?? []).map((appItem: any) => (
                <SelectItem key={appItem.id ?? appItem.app_ref} value={appItem.id ?? appItem.app_ref}>
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
  const bancoAppOnlyColumns: ColumnDef<any, any>[] = useMemo(
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

  // History columns
  const historyColumns: ColumnDef<any, any>[] = useMemo(
    () => [
      { accessorKey: "id", header: "ID", cell: ({ row }) => (
        <span className="font-medium">#{row.original.id}</span>
      )},
      { accessorKey: "type", header: "Tipo", cell: ({ row }) => (
        <Badge variant="outline">{row.original.type ?? row.original.reconciliation_type ?? "-"}</Badge>
      )},
      { accessorKey: "period", header: "Periodo", cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.period ?? "-"}</span>
      )},
      { accessorKey: "matched", header: "Conciliados", cell: ({ row }) => (
        <span className="font-mono text-green-600">{row.original.matched ?? "-"}</span>
      )},
      { accessorKey: "unmatched", header: "No conciliados", cell: ({ row }) => (
        <span className="font-mono text-red-600">{row.original.unmatched ?? "-"}</span>
      )},
      { accessorKey: "created_at", header: "Fecha", cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.created_at ? formatDateTime(row.original.created_at) : "-"}
        </span>
      )},
    ],
    []
  );

  /* ---------- Render ---------- */

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Conciliacion</h1>
        <p className="text-sm text-muted-foreground">
          Concilia registros entre SAT, Odoo, la aplicacion y el banco para detectar discrepancias.
        </p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="sat-odoo" className="gap-1.5">
            <ShieldCheck className="size-4" />
            SAT - Odoo
          </TabsTrigger>
          <TabsTrigger value="sat-app" className="gap-1.5">
            <FileSearch className="size-4" />
            SAT - App
          </TabsTrigger>
          <TabsTrigger value="banco-app" className="gap-1.5">
            <Landmark className="size-4" />
            Banco - App
          </TabsTrigger>
        </TabsList>

        {/* ========== TAB 1: SAT - Odoo ========== */}
        <TabsContent value="sat-odoo" className="space-y-6">
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
        </TabsContent>

        {/* ========== TAB 2: SAT - App ========== */}
        <TabsContent value="sat-app" className="space-y-6">
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
        </TabsContent>

        {/* ========== TAB 3: Banco - App ========== */}
        <TabsContent value="banco-app" className="space-y-6">
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
        </TabsContent>
      </Tabs>

      {/* History Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Historial de Conciliaciones</CardTitle>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-32" />
                </div>
              ))}
            </div>
          ) : (
            <DataTable
              columns={historyColumns}
              data={history ?? []}
              emptyState="No hay conciliaciones previas registradas."
            />
          )}
        </CardContent>
      </Card>

      {/* Confirm Dialog (shared) */}
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
