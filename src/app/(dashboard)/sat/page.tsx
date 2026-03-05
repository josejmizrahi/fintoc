"use client";

import { useState, useMemo } from "react";
import { PermissionGate } from "@/components/shared/permission-gate";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  ScrollText,
  FileText,
  Download,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Shield,
  ShieldAlert,
  Clock,
  Eye,
  FileDown,
  Play,
  Square,
  Calendar,
  Building2,
  Search,
} from "lucide-react";

import { api } from "@/lib/api";
import { formatMoney, formatDate } from "@/lib/utils/format";
import { TIPO_COMPROBANTE } from "@/lib/sat";

import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { SearchInput } from "@/components/shared/search-input";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface SyntageInvoice {
  id: string;
  uuid: string;
  type: string;
  status: string;
  issuer: { rfc: string; name: string; fiscalRegime?: string };
  receiver: { rfc: string; name: string; cfdiUse?: string };
  total: number;
  subtotal: number;
  currency: string;
  paymentMethod?: string;
  paymentForm?: string;
  issuedAt: string;
  certifiedAt: string;
  cancelledAt?: string;
  blacklistStatus?: string;
}

interface SyntageExtraction {
  id: string;
  status: string;
  extractor: string;
  taxpayer: string;
  createdAt: string;
  updatedAt: string;
}

interface SyntageTaxpayer {
  id: string;
  rfc: string;
  name?: string;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const TIPO_LABELS: Record<string, string> = {
  I: "Ingreso",
  E: "Egreso",
  P: "Pago",
  N: "Nomina",
  T: "Traslado",
  ...TIPO_COMPROBANTE,
};

function cfdiTypeBadge(type: string) {
  const colors: Record<string, string> = {
    I: "bg-green-100 text-green-800",
    E: "bg-red-100 text-red-800",
    P: "bg-blue-100 text-blue-800",
    N: "bg-purple-100 text-purple-800",
    T: "bg-gray-100 text-gray-800",
  };
  return (
    <Badge variant="outline" className={colors[type] || "bg-gray-100 text-gray-800"}>
      {TIPO_LABELS[type] || type}
    </Badge>
  );
}

function satStatusBadge(status: string) {
  if (!status) return <Badge variant="outline" className="text-muted-foreground">Sin validar</Badge>;
  if (status === "Vigente") return <Badge className="bg-green-100 text-green-800 hover:bg-green-200">Vigente</Badge>;
  if (status === "Cancelado") return <Badge variant="destructive">Cancelado</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function extractionStatusBadge(status: string) {
  const map: Record<string, { class: string; label: string }> = {
    pending: { class: "bg-gray-100 text-gray-800", label: "Pendiente" },
    waiting: { class: "bg-yellow-100 text-yellow-800", label: "En espera" },
    running: { class: "bg-blue-100 text-blue-800 animate-pulse", label: "Ejecutando..." },
    finished: { class: "bg-green-100 text-green-800", label: "Completada" },
    failed: { class: "bg-red-100 text-red-800", label: "Fallida" },
    stopping: { class: "bg-orange-100 text-orange-800", label: "Deteniendo..." },
    stopped: { class: "bg-gray-100 text-gray-800", label: "Detenida" },
    cancelled: { class: "bg-gray-100 text-gray-800", label: "Cancelada" },
  };
  const info = map[status] || { class: "bg-gray-100 text-gray-800", label: status };
  return <Badge variant="outline" className={info.class}>{info.label}</Badge>;
}

function complianceBadge(result: string) {
  if (result === "positive") return <Badge className="bg-green-100 text-green-800">Positiva</Badge>;
  if (result === "negative") return <Badge variant="destructive">Negativa</Badge>;
  if (result === "no_obligations") return <Badge variant="outline">Sin obligaciones</Badge>;
  if (result === "activity_suspended") return <Badge className="bg-yellow-100 text-yellow-800">Actividad suspendida</Badge>;
  return <Badge variant="outline">{result}</Badge>;
}

const EXTRACTOR_LABELS: Record<string, string> = {
  invoice: "Facturas CFDI",
  annual_tax_return: "Declaracion Anual",
  monthly_tax_return: "Declaracion Mensual",
  electronic_accounting: "Contabilidad Electronica",
  tax_status: "Constancia Fiscal",
  tax_compliance: "Opinion Cumplimiento",
  tax_retention: "Retenciones",
  rpc: "Registro Publico",
  buro_de_credito_report: "Buro de Credito",
};

/* ------------------------------------------------------------------ */
/* Query Keys                                                          */
/* ------------------------------------------------------------------ */

const satKeys = {
  all: ["sat-syntage"] as const,
  status: () => [...satKeys.all, "status"] as const,
  taxpayers: () => [...satKeys.all, "taxpayers"] as const,
  credentials: () => [...satKeys.all, "credentials"] as const,
  invoices: (taxpayerId: string, params: Record<string, string>) =>
    [...satKeys.all, "invoices", taxpayerId, params] as const,
  extractions: () => [...satKeys.all, "extractions"] as const,
  taxReturns: (taxpayerId: string) => [...satKeys.all, "tax-returns", taxpayerId] as const,
  taxCompliance: (taxpayerId: string) => [...satKeys.all, "tax-compliance", taxpayerId] as const,
  taxStatus: (taxpayerId: string) => [...satKeys.all, "tax-status", taxpayerId] as const,
  taxRetentions: (taxpayerId: string) => [...satKeys.all, "tax-retentions", taxpayerId] as const,
};

/* ------------------------------------------------------------------ */
/* Main Page                                                           */
/* ------------------------------------------------------------------ */

export default function SatPage() {
  const [activeTab, setActiveTab] = useState("facturas");
  const queryClient = useQueryClient();

  // ── Connection status ──
  const statusQuery = useQuery({
    queryKey: satKeys.status(),
    queryFn: () => api.sat.syntage.status(),
    staleTime: 60_000,
    retry: false,
  });

  // ── Taxpayers ──
  const taxpayersQuery = useQuery({
    queryKey: satKeys.taxpayers(),
    queryFn: () => api.sat.syntage.taxpayers(),
    staleTime: 60_000,
    enabled: statusQuery.data?.ok === true,
  });

  const taxpayers: SyntageTaxpayer[] = taxpayersQuery.data?.taxpayers || [];
  const [selectedTaxpayer, setSelectedTaxpayer] = useState<string>("");
  const activeTaxpayer = selectedTaxpayer || taxpayers[0]?.id || "";

  const permFallback = (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-muted-foreground">
      <ShieldAlert className="size-12" />
      <p className="text-lg font-medium">Acceso restringido</p>
      <p className="text-sm">No tienes permisos para ver SAT.</p>
    </div>
  );

  // Not connected? Show setup prompt
  if (statusQuery.isSuccess && !statusQuery.data?.ok) {
    return (
      <PermissionGate permission="invoices:read" fallback={permFallback}>
      <div className="space-y-6 p-6">
        <h1 className="text-2xl font-bold">SAT via Syntage</h1>
        <EmptyState
          icon={ScrollText}
          title="Syntage no configurado"
          description="Conecta tu API Key de Syntage en Configuracion > Integraciones para acceder a los datos del SAT."
          action={{ label: "Ir a Configuracion", onClick: () => window.location.href = "/configuracion" }}
        />
      </div>
      </PermissionGate>
    );
  }

  return (
    <PermissionGate permission="invoices:read" fallback={permFallback}>
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">SAT via Syntage</h1>
          <p className="text-sm text-muted-foreground">
            Gestion fiscal completa: facturas, declaraciones, cumplimiento y retenciones
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Taxpayer selector */}
          {taxpayers.length > 1 && (
            <Select value={activeTaxpayer} onValueChange={setSelectedTaxpayer}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Contribuyente" />
              </SelectTrigger>
              <SelectContent>
                {taxpayers.map((tp) => (
                  <SelectItem key={tp.id} value={tp.id}>
                    {tp.name || tp.rfc}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {taxpayers.length === 1 && (
            <Badge variant="outline" className="text-sm">
              RFC: {taxpayers[0].rfc}
            </Badge>
          )}
          {statusQuery.data?.ok && (
            <Badge className="bg-green-100 text-green-800">Syntage conectado</Badge>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="facturas">Facturas CFDI</TabsTrigger>
          <TabsTrigger value="extractions">Extractions</TabsTrigger>
          <TabsTrigger value="status">Status Fiscal</TabsTrigger>
          <TabsTrigger value="retenciones">Retenciones</TabsTrigger>
          <TabsTrigger value="declaraciones">Declaraciones</TabsTrigger>
        </TabsList>

        <TabsContent value="facturas" className="space-y-4">
          <InvoicesTab taxpayerId={activeTaxpayer} />
        </TabsContent>

        <TabsContent value="extractions" className="space-y-4">
          <ExtractionsTab taxpayerId={activeTaxpayer} />
        </TabsContent>

        <TabsContent value="status" className="space-y-4">
          <TaxStatusTab taxpayerId={activeTaxpayer} />
        </TabsContent>

        <TabsContent value="retenciones" className="space-y-4">
          <RetentionsTab taxpayerId={activeTaxpayer} />
        </TabsContent>

        <TabsContent value="declaraciones" className="space-y-4">
          <TaxReturnsTab taxpayerId={activeTaxpayer} />
        </TabsContent>
      </Tabs>
    </div>
    </PermissionGate>
  );
}

/* ================================================================== */
/* TAB 1: FACTURAS CFDI                                                */
/* ================================================================== */

function InvoicesTab({ taxpayerId }: { taxpayerId: string }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [selectedInvoice, setSelectedInvoice] = useState<SyntageInvoice | null>(null);
  const [showExtractDialog, setShowExtractDialog] = useState(false);

  const params: Record<string, string> = {
    page: String(page),
    itemsPerPage: "25",
  };

  const invoicesQuery = useQuery({
    queryKey: satKeys.invoices(taxpayerId, params),
    queryFn: () => api.sat.syntage.invoices(taxpayerId, params),
    enabled: !!taxpayerId,
    staleTime: 30_000,
    placeholderData: (prev: unknown) => prev,
  });

  const extractMutation = useMutation({
    mutationFn: (data: { extractor?: string; options?: unknown }) =>
      api.sat.syntage.extract(taxpayerId, data.extractor, data.options as any),
    onSuccess: () => {
      toast.success("Extraction creada. Syntage descargara las facturas del SAT.");
      queryClient.invalidateQueries({ queryKey: satKeys.extractions() });
      setShowExtractDialog(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const invoices: SyntageInvoice[] = invoicesQuery.data?.invoices || [];
  const total = invoicesQuery.data?.total || 0;

  // Client-side search/filter on current page
  const filtered = useMemo(() => {
    let result = invoices;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (inv) =>
          inv.uuid?.toLowerCase().includes(q) ||
          inv.issuer?.name?.toLowerCase().includes(q) ||
          inv.issuer?.rfc?.toLowerCase().includes(q) ||
          inv.receiver?.name?.toLowerCase().includes(q) ||
          inv.receiver?.rfc?.toLowerCase().includes(q),
      );
    }
    if (typeFilter !== "all") {
      result = result.filter((inv) => inv.type === typeFilter);
    }
    return result;
  }, [invoices, search, typeFilter]);

  const columns: ColumnDef<SyntageInvoice>[] = [
    {
      accessorKey: "uuid",
      header: "UUID",
      cell: ({ row }) => (
        <span className="font-mono text-xs" title={row.original.uuid}>
          {row.original.uuid?.substring(0, 8)}...
        </span>
      ),
    },
    {
      id: "emisor",
      header: "Emisor",
      cell: ({ row }) => (
        <div>
          <p className="text-sm font-medium truncate max-w-[180px]">{row.original.issuer?.name}</p>
          <p className="text-xs text-muted-foreground">{row.original.issuer?.rfc}</p>
        </div>
      ),
    },
    {
      id: "receptor",
      header: "Receptor",
      cell: ({ row }) => (
        <div>
          <p className="text-sm font-medium truncate max-w-[180px]">{row.original.receiver?.name}</p>
          <p className="text-xs text-muted-foreground">{row.original.receiver?.rfc}</p>
        </div>
      ),
    },
    {
      accessorKey: "type",
      header: "Tipo",
      cell: ({ row }) => cfdiTypeBadge(row.original.type),
    },
    {
      accessorKey: "total",
      header: "Total",
      cell: ({ row }) => (
        <span className="text-right font-medium">
          {formatMoney(row.original.total, row.original.currency)}
        </span>
      ),
    },
    {
      accessorKey: "issuedAt",
      header: "Fecha",
      cell: ({ row }) => (
        <span className="text-sm">{row.original.issuedAt ? formatDate(row.original.issuedAt) : "-"}</span>
      ),
    },
    {
      accessorKey: "paymentMethod",
      header: "Metodo",
      cell: ({ row }) => {
        const pm = row.original.paymentMethod;
        if (!pm) return <span className="text-muted-foreground">-</span>;
        return (
          <Badge variant="outline" className={pm === "PPD" ? "bg-orange-100 text-orange-800" : "bg-blue-100 text-blue-800"}>
            {pm}
          </Badge>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Estado SAT",
      cell: ({ row }) => satStatusBadge(row.original.status),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <Eye className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setSelectedInvoice(row.original)}>
              <Eye className="h-4 w-4 mr-2" /> Ver detalle
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleDownloadCfdi(row.original.id, "xml")}>
              <FileDown className="h-4 w-4 mr-2" /> Descargar XML
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleDownloadCfdi(row.original.id, "pdf")}>
              <FileDown className="h-4 w-4 mr-2" /> Descargar PDF
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  async function handleDownloadCfdi(invoiceId: string, _format: string) {
    try {
      const data = await api.sat.syntage.invoiceCfdi(invoiceId);
      if (data.downloadUrl) window.open(data.downloadUrl, "_blank");
      else toast.info("CFDI descargado");
    } catch (e) {
      toast.error("Error al descargar CFDI");
    }
  }

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1">
          <SearchInput
            placeholder="Buscar por UUID, RFC, nombre..."
            value={search}
            onChange={setSearch}
          />
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="I">Ingreso</SelectItem>
              <SelectItem value="E">Egreso</SelectItem>
              <SelectItem value="P">Pago</SelectItem>
              <SelectItem value="N">Nomina</SelectItem>
              <SelectItem value="T">Traslado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: satKeys.invoices(taxpayerId, params) })}>
            <RefreshCw className="h-4 w-4 mr-2" /> Actualizar
          </Button>
          <Button onClick={() => setShowExtractDialog(true)}>
            <Download className="h-4 w-4 mr-2" /> Sincronizar SAT
          </Button>
        </div>
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        data={filtered}
        isLoading={invoicesQuery.isLoading}
        pagination={{ page, pageSize: 25, total }}
        onPaginationChange={(p) => setPage(p.page)}
        onRowClick={setSelectedInvoice}
        emptyState={
          <EmptyState
            icon={FileText}
            title="No hay facturas CFDI"
            description="Sincroniza con el SAT para descargar tus facturas via Syntage."
            action={{ label: "Sincronizar SAT", onClick: () => setShowExtractDialog(true) }}
          />
        }
      />

      {/* Invoice Detail Dialog */}
      {selectedInvoice && (
        <Dialog open={!!selectedInvoice} onOpenChange={() => setSelectedInvoice(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Detalle CFDI</DialogTitle>
              <DialogDescription>UUID: {selectedInvoice.uuid}</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Emisor</p>
                <p className="font-medium">{selectedInvoice.issuer?.name}</p>
                <p className="text-xs text-muted-foreground">RFC: {selectedInvoice.issuer?.rfc}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Receptor</p>
                <p className="font-medium">{selectedInvoice.receiver?.name}</p>
                <p className="text-xs text-muted-foreground">RFC: {selectedInvoice.receiver?.rfc}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Tipo</p>
                {cfdiTypeBadge(selectedInvoice.type)}
              </div>
              <div>
                <p className="text-muted-foreground">Total</p>
                <p className="font-medium">{formatMoney(selectedInvoice.total, selectedInvoice.currency)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Subtotal</p>
                <p>{formatMoney(selectedInvoice.subtotal, selectedInvoice.currency)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Moneda</p>
                <p>{selectedInvoice.currency}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Fecha emision</p>
                <p>{selectedInvoice.issuedAt ? formatDate(selectedInvoice.issuedAt) : "-"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Metodo pago</p>
                <p>{selectedInvoice.paymentMethod || "-"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Forma pago</p>
                <p>{selectedInvoice.paymentForm || "-"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Estado SAT</p>
                {satStatusBadge(selectedInvoice.status)}
              </div>
              {selectedInvoice.cancelledAt && (
                <div>
                  <p className="text-muted-foreground">Fecha cancelacion</p>
                  <p className="text-red-600">{formatDate(selectedInvoice.cancelledAt)}</p>
                </div>
              )}
              {selectedInvoice.receiver?.cfdiUse && (
                <div>
                  <p className="text-muted-foreground">Uso CFDI</p>
                  <p>{selectedInvoice.receiver.cfdiUse}</p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleDownloadCfdi(selectedInvoice.id, "xml")}>
                <FileDown className="h-4 w-4 mr-2" /> XML
              </Button>
              <Button variant="outline" onClick={() => handleDownloadCfdi(selectedInvoice.id, "pdf")}>
                <FileDown className="h-4 w-4 mr-2" /> PDF
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Extract Dialog */}
      <NewExtractionDialog
        open={showExtractDialog}
        onClose={() => setShowExtractDialog(false)}
        taxpayerId={taxpayerId}
        defaultExtractor="invoice"
        onSubmit={(extractor, options) => extractMutation.mutate({ extractor, options })}
        isLoading={extractMutation.isPending}
      />
    </>
  );
}

/* ================================================================== */
/* TAB 2: EXTRACTIONS                                                  */
/* ================================================================== */

function ExtractionsTab({ taxpayerId }: { taxpayerId: string }) {
  const queryClient = useQueryClient();
  const [showNew, setShowNew] = useState(false);

  const extractionsQuery = useQuery({
    queryKey: satKeys.extractions(),
    queryFn: () => api.sat.syntage.extractions(),
    staleTime: 10_000,
    refetchInterval: (query) => {
      // Auto-refetch while any extraction is running
      const data = query.state.data as { extractions?: SyntageExtraction[] } | undefined;
      const hasRunning = data?.extractions?.some(
        (e: SyntageExtraction) => ["pending", "waiting", "running"].includes(e.status),
      );
      return hasRunning ? 5000 : false;
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: { extractor: string; options?: unknown }) =>
      api.sat.syntage.extract(taxpayerId, data.extractor, data.options as any),
    onSuccess: () => {
      toast.success("Extraction creada exitosamente");
      queryClient.invalidateQueries({ queryKey: satKeys.extractions() });
      setShowNew(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const stopMutation = useMutation({
    mutationFn: (id: string) => api.sat.syntage.stopExtraction(id),
    onSuccess: () => {
      toast.success("Extraction detenida");
      queryClient.invalidateQueries({ queryKey: satKeys.extractions() });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const extractions: SyntageExtraction[] = extractionsQuery.data?.extractions || [];

  const columns: ColumnDef<SyntageExtraction>[] = [
    {
      accessorKey: "id",
      header: "ID",
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.id.substring(0, 8)}...</span>,
    },
    {
      accessorKey: "extractor",
      header: "Tipo",
      cell: ({ row }) => (
        <span className="text-sm">{EXTRACTOR_LABELS[row.original.extractor] || row.original.extractor}</span>
      ),
    },
    {
      accessorKey: "status",
      header: "Estado",
      cell: ({ row }) => extractionStatusBadge(row.original.status),
    },
    {
      accessorKey: "createdAt",
      header: "Creada",
      cell: ({ row }) => <span className="text-sm">{formatDate(row.original.createdAt)}</span>,
    },
    {
      accessorKey: "updatedAt",
      header: "Actualizada",
      cell: ({ row }) => <span className="text-sm">{formatDate(row.original.updatedAt)}</span>,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const isRunning = ["pending", "waiting", "running"].includes(row.original.status);
        return isRunning ? (
          <Button variant="ghost" size="sm" onClick={() => stopMutation.mutate(row.original.id)}>
            <Square className="h-4 w-4 text-red-500" />
          </Button>
        ) : null;
      },
    },
  ];

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Jobs de descarga de datos del SAT via Syntage
        </p>
        <Button onClick={() => setShowNew(true)}>
          <Play className="h-4 w-4 mr-2" /> Nueva Extraction
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={extractions}
        isLoading={extractionsQuery.isLoading}
        emptyState={
          <EmptyState
            icon={Download}
            title="No hay extractions"
            description="Crea una extraction para descargar datos del SAT."
            action={{ label: "Nueva Extraction", onClick: () => setShowNew(true) }}
          />
        }
      />

      <NewExtractionDialog
        open={showNew}
        onClose={() => setShowNew(false)}
        taxpayerId={taxpayerId}
        onSubmit={(extractor, options) => createMutation.mutate({ extractor, options })}
        isLoading={createMutation.isPending}
      />
    </>
  );
}

/* ================================================================== */
/* TAB 3: STATUS FISCAL                                                */
/* ================================================================== */

function TaxStatusTab({ taxpayerId }: { taxpayerId: string }) {
  const queryClient = useQueryClient();

  const taxStatusQuery = useQuery({
    queryKey: satKeys.taxStatus(taxpayerId),
    queryFn: () => api.sat.syntage.taxStatus(taxpayerId),
    enabled: !!taxpayerId,
    staleTime: 60_000,
  });

  const complianceQuery = useQuery({
    queryKey: satKeys.taxCompliance(taxpayerId),
    queryFn: () => api.sat.syntage.taxCompliance(taxpayerId),
    enabled: !!taxpayerId,
    staleTime: 60_000,
  });

  const extractMutation = useMutation({
    mutationFn: (extractor: string) => api.sat.syntage.extract(taxpayerId, extractor),
    onSuccess: () => {
      toast.success("Actualizacion solicitada. Se procesara en Syntage.");
      queryClient.invalidateQueries({ queryKey: satKeys.extractions() });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const statuses = taxStatusQuery.data?.statuses || [];
  const latestStatus = statuses[0] as Record<string, unknown> | undefined;
  const checks = complianceQuery.data?.checks || [];
  const latestCheck = checks[0] as Record<string, unknown> | undefined;

  return (
    <div className="space-y-6">
      {/* Constancia de Situacion Fiscal */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Constancia de Situacion Fiscal</CardTitle>
              <CardDescription>Datos del contribuyente extraidos del SAT</CardDescription>
            </div>
            <Button
              variant="outline"
              onClick={() => extractMutation.mutate("tax_status")}
              disabled={extractMutation.isPending}
            >
              {extractMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Actualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {taxStatusQuery.isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-6 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : latestStatus ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">RFC</p>
                <p className="font-medium font-mono">{String(latestStatus.rfc || "-")}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Razon Social</p>
                <p className="font-medium">{String(latestStatus.name || "-")}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Status</p>
                <p className="font-medium">{String(latestStatus.status || "-")}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Regimen Fiscal</p>
                <p>{String(latestStatus.fiscalRegime || "-")}</p>
              </div>
              {latestStatus.createdAt != null && (
                <div>
                  <p className="text-muted-foreground">Fecha consulta</p>
                  <p>{formatDate(latestStatus.createdAt as string)}</p>
                </div>
              )}
            </div>
          ) : (
            <EmptyState
              icon={Building2}
              title="Sin datos fiscales"
              description="Solicita una extraction de tipo 'Constancia Fiscal' para obtener los datos."
              action={{ label: "Solicitar", onClick: () => extractMutation.mutate("tax_status") }}
            />
          )}
        </CardContent>
      </Card>

      {/* Opinion de Cumplimiento */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Opinion de Cumplimiento</CardTitle>
              <CardDescription>Resultado de la verificacion de cumplimiento fiscal ante el SAT</CardDescription>
            </div>
            <Button
              variant="outline"
              onClick={() => extractMutation.mutate("tax_compliance")}
              disabled={extractMutation.isPending}
            >
              {extractMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Actualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {complianceQuery.isLoading ? (
            <div className="h-12 bg-muted animate-pulse rounded" />
          ) : latestCheck ? (
            <div className="flex items-center gap-6">
              <div>
                <p className="text-muted-foreground text-sm">Resultado</p>
                {complianceBadge(String(latestCheck.result || ""))}
              </div>
              {latestCheck.validFrom != null && (
                <div>
                  <p className="text-muted-foreground text-sm">Vigencia</p>
                  <p className="text-sm">
                    {formatDate(latestCheck.validFrom as string)}
                    {latestCheck.validTo != null && ` - ${formatDate(latestCheck.validTo as string)}`}
                  </p>
                </div>
              )}
              {latestCheck.createdAt != null && (
                <div>
                  <p className="text-muted-foreground text-sm">Fecha consulta</p>
                  <p className="text-sm">{formatDate(latestCheck.createdAt as string)}</p>
                </div>
              )}
            </div>
          ) : (
            <EmptyState
              icon={Shield}
              title="Sin opinion de cumplimiento"
              description="Solicita una verificacion para conocer tu estado fiscal."
              action={{ label: "Verificar", onClick: () => extractMutation.mutate("tax_compliance") }}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ================================================================== */
/* TAB 4: RETENCIONES                                                  */
/* ================================================================== */

function RetentionsTab({ taxpayerId }: { taxpayerId: string }) {
  const retentionsQuery = useQuery({
    queryKey: satKeys.taxRetentions(taxpayerId),
    queryFn: () => api.sat.syntage.taxRetentions(taxpayerId),
    enabled: !!taxpayerId,
    staleTime: 60_000,
  });

  const retentions = (retentionsQuery.data?.retentions || []) as Array<Record<string, unknown>>;

  const columns: ColumnDef<Record<string, unknown>>[] = [
    {
      accessorKey: "uuid",
      header: "UUID",
      cell: ({ row }) => (
        <span className="font-mono text-xs">{String(row.original.uuid || "").substring(0, 8)}...</span>
      ),
    },
    {
      id: "emisor",
      header: "Emisor",
      cell: ({ row }) => {
        const issuer = row.original.issuer as Record<string, string> | undefined;
        return (
          <div>
            <p className="text-sm">{issuer?.name || "-"}</p>
            <p className="text-xs text-muted-foreground">{issuer?.rfc || ""}</p>
          </div>
        );
      },
    },
    {
      id: "receptor",
      header: "Receptor",
      cell: ({ row }) => {
        const receiver = row.original.receiver as Record<string, string> | undefined;
        return (
          <div>
            <p className="text-sm">{receiver?.name || "-"}</p>
            <p className="text-xs text-muted-foreground">{receiver?.rfc || ""}</p>
          </div>
        );
      },
    },
    {
      accessorKey: "total",
      header: "Monto",
      cell: ({ row }) => (
        <span className="font-medium">{formatMoney(Number(row.original.total) || 0)}</span>
      ),
    },
    {
      accessorKey: "issuedAt",
      header: "Fecha",
      cell: ({ row }) => (
        <span className="text-sm">{row.original.issuedAt ? formatDate(String(row.original.issuedAt)) : "-"}</span>
      ),
    },
  ];

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Retenciones e informacion de pagos del contribuyente
      </p>
      <DataTable
        columns={columns}
        data={retentions}
        isLoading={retentionsQuery.isLoading}
        emptyState={
          <EmptyState
            icon={ShieldAlert}
            title="No hay retenciones"
            description="Las retenciones apareceran aqui despues de una extraction de tipo 'Retenciones'."
          />
        }
      />
    </>
  );
}

/* ================================================================== */
/* TAB 5: DECLARACIONES                                                */
/* ================================================================== */

function TaxReturnsTab({ taxpayerId }: { taxpayerId: string }) {
  const taxReturnsQuery = useQuery({
    queryKey: satKeys.taxReturns(taxpayerId),
    queryFn: () => api.sat.syntage.taxReturns(taxpayerId),
    enabled: !!taxpayerId,
    staleTime: 60_000,
  });

  const taxReturns = (taxReturnsQuery.data?.taxReturns || []) as Array<Record<string, unknown>>;

  const columns: ColumnDef<Record<string, unknown>>[] = [
    {
      accessorKey: "operationNumber",
      header: "No. Operacion",
      cell: ({ row }) => <span className="font-mono text-xs">{String(row.original.operationNumber || "-")}</span>,
    },
    {
      accessorKey: "type",
      header: "Tipo",
      cell: ({ row }) => {
        const type = String(row.original.type || "");
        const labels: Record<string, string> = {
          annual: "Anual",
          monthly: "Mensual",
          rif: "RIF",
        };
        return <Badge variant="outline">{labels[type] || type}</Badge>;
      },
    },
    {
      accessorKey: "period",
      header: "Periodo",
      cell: ({ row }) => <span className="text-sm">{String(row.original.period || "-")}</span>,
    },
    {
      accessorKey: "year",
      header: "Anio",
      cell: ({ row }) => <span className="text-sm">{String(row.original.year || "-")}</span>,
    },
    {
      accessorKey: "normalOrComplementary",
      header: "Tipo Declaracion",
      cell: ({ row }) => {
        const val = String(row.original.normalOrComplementary || "");
        return val === "complementary" ? (
          <Badge variant="outline" className="bg-yellow-100 text-yellow-800">Complementaria</Badge>
        ) : (
          <Badge variant="outline" className="bg-blue-100 text-blue-800">Normal</Badge>
        );
      },
    },
    {
      accessorKey: "createdAt",
      header: "Fecha",
      cell: ({ row }) => (
        <span className="text-sm">{row.original.createdAt ? formatDate(String(row.original.createdAt)) : "-"}</span>
      ),
    },
  ];

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Declaraciones fiscales del contribuyente (anuales, mensuales, provisionales)
      </p>
      <DataTable
        columns={columns}
        data={taxReturns}
        isLoading={taxReturnsQuery.isLoading}
        emptyState={
          <EmptyState
            icon={Calendar}
            title="No hay declaraciones"
            description="Las declaraciones apareceran aqui despues de una extraction de tipo 'Declaracion'."
          />
        }
      />
    </>
  );
}

/* ================================================================== */
/* SHARED: New Extraction Dialog                                       */
/* ================================================================== */

function NewExtractionDialog({
  open,
  onClose,
  taxpayerId,
  defaultExtractor,
  onSubmit,
  isLoading,
}: {
  open: boolean;
  onClose: () => void;
  taxpayerId: string;
  defaultExtractor?: string;
  onSubmit: (extractor: string, options?: unknown) => void;
  isLoading: boolean;
}) {
  const [extractor, setExtractor] = useState(defaultExtractor || "invoice");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  function handleSubmit() {
    const options: Record<string, unknown> = {};
    if (dateFrom && dateTo) {
      options.period = { from: dateFrom, to: dateTo };
    }
    if (extractor === "invoice") {
      options.issued = true;
      options.received = true;
    }
    onSubmit(extractor, Object.keys(options).length > 0 ? options : undefined);
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva Extraction</DialogTitle>
          <DialogDescription>
            Crea un job para descargar datos del SAT via Syntage
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Tipo de extraction</Label>
            <Select value={extractor} onValueChange={setExtractor}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="invoice">Facturas CFDI</SelectItem>
                <SelectItem value="annual_tax_return">Declaracion Anual</SelectItem>
                <SelectItem value="monthly_tax_return">Declaracion Mensual</SelectItem>
                <SelectItem value="tax_status">Constancia Fiscal</SelectItem>
                <SelectItem value="tax_compliance">Opinion Cumplimiento</SelectItem>
                <SelectItem value="tax_retention">Retenciones</SelectItem>
                <SelectItem value="electronic_accounting">Contabilidad Electronica</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {extractor === "invoice" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Desde</Label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Hasta</Label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={isLoading}>
            {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Crear Extraction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
