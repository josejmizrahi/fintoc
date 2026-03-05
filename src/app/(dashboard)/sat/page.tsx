"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { type z } from "zod";
import { toast } from "sonner";
import {
  Search,
  FileText,
  Upload,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldAlert,
  Shield,
  Loader2,
  Download,
  RefreshCw,
  Link as LinkIcon,
  Eye,
} from "lucide-react";

import { api } from "@/lib/api";
import { formatMoney, formatDate } from "@/lib/utils/format";
import { satValidateSchema } from "@/lib/utils/validation";
import { TIPO_COMPROBANTE } from "@/lib/sat";
import type { CfdiDocument } from "@/types";

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
import { Switch } from "@/components/ui/switch";
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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
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

type SatValidateInput = z.infer<typeof satValidateSchema>;

interface ValidationResult {
  estado?: string;
  esCancelable?: string;
  estatusCancelacion?: string;
  fechaTimbrado?: string;
  efosStatus?: string;
  efosCode?: string;
  hasEfosIssue?: boolean;
  isValid?: boolean;
}

interface BulkValidationResult {
  uuid: string;
  emisor?: string;
  estado_anterior?: string;
  estado_nuevo?: string;
  efos_status?: string;
  changed?: boolean;
}

/* ------------------------------------------------------------------ */
/* Semaforo helper: green / yellow / red                               */
/* ------------------------------------------------------------------ */

type SemaforoColor = "green" | "yellow" | "red";

function getSemaforoColor(result: ValidationResult): SemaforoColor {
  const estado = result.estado?.toLowerCase() ?? "";
  const efos = result.efosStatus?.toLowerCase() ?? "";

  if (estado === "cancelado") return "red";
  if (efos === "definitive" || efos === "definitivo" || efos === "203")
    return "red";
  if (efos === "presumed" || efos === "201") return "yellow";
  if (estado === "vigente") return "green";
  return "yellow";
}

const SEMAFORO_STYLES: Record<SemaforoColor, string> = {
  green:
    "border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950",
  yellow:
    "border-yellow-300 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950",
  red: "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950",
};

const SEMAFORO_RING: Record<SemaforoColor, string> = {
  green: "ring-green-500",
  yellow: "ring-yellow-500",
  red: "ring-red-500",
};

const SEMAFORO_BG: Record<SemaforoColor, string> = {
  green: "bg-green-500",
  yellow: "bg-yellow-500",
  red: "bg-red-500",
};

/* ------------------------------------------------------------------ */
/* SAT Status Badge                                                    */
/* ------------------------------------------------------------------ */

function SatStatusBadge({ status }: { status?: string }) {
  const s = status?.toLowerCase() ?? "";
  if (s === "vigente")
    return (
      <Badge className="bg-green-600 hover:bg-green-700 text-white">
        Vigente
      </Badge>
    );
  if (s === "cancelado") return <Badge variant="destructive">Cancelado</Badge>;
  if (s === "no encontrado")
    return (
      <Badge className="bg-yellow-500 hover:bg-yellow-600 text-white">
        No encontrado
      </Badge>
    );
  return <Badge variant="outline">{status || "Desconocido"}</Badge>;
}

/* ------------------------------------------------------------------ */
/* EFOS Badge                                                          */
/* ------------------------------------------------------------------ */

function EfosBadge({ status }: { status?: string }) {
  if (!status || status === "unknown")
    return <Badge variant="outline">Sin verificar</Badge>;
  if (status === "clean" || status === "200")
    return (
      <Badge className="bg-green-600 text-white">
        <Shield className="mr-1 size-3" />
        Limpio
      </Badge>
    );
  if (status === "presumed" || status === "201")
    return (
      <Badge className="bg-yellow-500 text-white">
        <ShieldAlert className="mr-1 size-3" />
        Presunto
      </Badge>
    );
  if (status === "definitive" || status === "definitivo" || status === "203")
    return (
      <Badge variant="destructive">
        <ShieldAlert className="mr-1 size-3" />
        Definitivo
      </Badge>
    );
  if (status === "disproved" || status === "202")
    return <Badge className="bg-blue-600 text-white">Desvirtuado</Badge>;
  if (status === "favorable" || status === "204")
    return <Badge className="bg-blue-600 text-white">Favorable</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

/* ------------------------------------------------------------------ */
/* Upload XML Dialog                                                   */
/* ------------------------------------------------------------------ */

function UploadXmlDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [xmlContent, setXmlContent] = useState("");

  const uploadMutation = useMutation({
    mutationFn: (data: { xml_content: string }) => api.sat.uploadXml(data),
    onSuccess: () => {
      toast.success("XML procesado exitosamente");
      queryClient.invalidateQueries({ queryKey: ["sat", "documents"] });
      setXmlContent("");
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Error al subir XML");
    },
  });

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xml")) {
      toast.error("Solo se aceptan archivos .xml");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => setXmlContent((ev.target?.result as string) || "");
    reader.readAsText(file);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Subir XML CFDI</DialogTitle>
          <DialogDescription>
            Sube un archivo XML para procesar y registrar el CFDI.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>Selecciona un archivo XML</Label>
            <Input type="file" accept=".xml" onChange={handleFileUpload} />
          </div>
          {xmlContent && (
            <div className="rounded-md border p-2 max-h-32 overflow-y-auto">
              <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap">
                {xmlContent.slice(0, 500)}
                {xmlContent.length > 500 ? "..." : ""}
              </pre>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => uploadMutation.mutate({ xml_content: xmlContent })}
              disabled={!xmlContent || uploadMutation.isPending}
            >
              {uploadMutation.isPending && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              <Upload className="mr-2 size-4" />
              Subir XML
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Descarga Masiva Dialog (3-step wizard)                              */
/* ------------------------------------------------------------------ */

function DescargaMasivaDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [step, setStep] = useState(1);
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");
  const [tipo, setTipo] = useState("recibidos");
  const [formato, setFormato] = useState("CFDI");
  const [tipoComp, setTipoComp] = useState("");

  const solicitudMutation = useMutation({
    mutationFn: (data: {
      request_type: string;
      solicitud_type: string;
      fecha_inicio: string;
      fecha_fin: string;
      tipo_comprobante?: string;
    }) => api.sat.descargaSolicitud(data),
    onSuccess: (result: { message?: string }) => {
      toast.success(result.message || "Solicitud creada exitosamente");
      setStep(3);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Error al crear solicitud");
    },
  });

  function handleSubmit() {
    solicitudMutation.mutate({
      request_type: tipo,
      solicitud_type: formato,
      fecha_inicio: `${fechaInicio}T00:00:00`,
      fecha_fin: `${fechaFin}T23:59:59`,
      tipo_comprobante: tipoComp || undefined,
    });
  }

  function handleClose() {
    setStep(1);
    setFechaInicio("");
    setFechaFin("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Download className="inline mr-2 size-5" />
            Descarga Masiva SAT
          </DialogTitle>
          <DialogDescription>
            Paso {step} de 3 &mdash; Requiere certificado FIEL configurado.
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Fecha Inicio</Label>
                <Input
                  type="date"
                  value={fechaInicio}
                  onChange={(e) => setFechaInicio(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label>Fecha Fin</Label>
                <Input
                  type="date"
                  value={fechaFin}
                  onChange={(e) => setFechaFin(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={setTipo}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recibidos">Recibidos</SelectItem>
                  <SelectItem value="emitidos">Emitidos</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Cancelar
              </Button>
              <Button
                onClick={() => setStep(2)}
                disabled={!fechaInicio || !fechaFin}
              >
                Siguiente
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Formato</Label>
              <Select value={formato} onValueChange={setFormato}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CFDI">XML Completo</SelectItem>
                  <SelectItem value="Metadata">Solo Metadata</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Tipo de Comprobante</Label>
              <Select value={tipoComp} onValueChange={setTipoComp}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Todos</SelectItem>
                  <SelectItem value="I">Ingreso</SelectItem>
                  <SelectItem value="E">Egreso</SelectItem>
                  <SelectItem value="P">Pago</SelectItem>
                  <SelectItem value="N">Nomina</SelectItem>
                  <SelectItem value="T">Traslado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-md border p-3 text-sm text-muted-foreground">
              <p>
                <strong>Resumen:</strong> {tipo} del {fechaInicio} al{" "}
                {fechaFin}, formato {formato}
                {tipoComp ? `, tipo ${tipoComp}` : ", todos los tipos"}.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(1)}>
                Atras
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={solicitudMutation.isPending}
              >
                {solicitudMutation.isPending && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                Solicitar Descarga
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 3 && (
          <div className="py-4 text-center space-y-4">
            <CheckCircle2 className="size-12 text-green-600 mx-auto" />
            <p className="text-sm text-muted-foreground">
              Solicitud enviada al SAT. El proceso puede tardar varios minutos.
              Revisa el estado en la tabla de documentos.
            </p>
            <Button onClick={handleClose}>Cerrar</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Link / Vincular Dialog                                              */
/* ------------------------------------------------------------------ */

function VincularDialog({
  open,
  onOpenChange,
  document,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: CfdiDocument | null;
}) {
  const queryClient = useQueryClient();
  const [invoiceId, setInvoiceId] = useState("");

  const linkMutation = useMutation({
    mutationFn: (data: { uuid: string; invoice_id: string }) =>
      api.sat.validate(data as any),
    onSuccess: () => {
      toast.success("CFDI vinculado exitosamente");
      queryClient.invalidateQueries({ queryKey: ["sat", "documents"] });
      setInvoiceId("");
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Error al vincular CFDI");
    },
  });

  if (!document) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Vincular CFDI</DialogTitle>
          <DialogDescription>
            Asocia el CFDI <span className="font-mono">{document.uuid}</span>{" "}
            con una factura del sistema.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>ID de Factura</Label>
            <Input
              placeholder="Ingresa el ID de la factura"
              value={invoiceId}
              onChange={(e) => setInvoiceId(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() =>
                linkMutation.mutate({
                  uuid: document.uuid,
                  invoice_id: invoiceId,
                })
              }
              disabled={!invoiceId || linkMutation.isPending}
            >
              {linkMutation.isPending && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              <LinkIcon className="mr-2 size-4" />
              Vincular
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ================================================================== */
/* Main Page                                                           */
/* ================================================================== */

export default function SATPage() {
  const queryClient = useQueryClient();

  /* ---- UI state ---- */
  const [activeTab, setActiveTab] = useState("validar");
  const [search, setSearch] = useState("");
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [descargaDialogOpen, setDescargaDialogOpen] = useState(false);
  const [showOnlyChanges, setShowOnlyChanges] = useState(false);
  const [vincularOpen, setVincularOpen] = useState(false);
  const [vincularDoc, setVincularDoc] = useState<CfdiDocument | null>(null);

  /* ---- Validation result ---- */
  const [validationResult, setValidationResult] =
    useState<ValidationResult | null>(null);

  /* ---- Bulk validation ---- */
  const [bulkResults, setBulkResults] = useState<BulkValidationResult[]>([]);
  const [bulkProgress, setBulkProgress] = useState(0);

  /* ================================================================ */
  /* Tab 1 - Validar CFDI                                             */
  /* ================================================================ */

  const validateForm = useForm<SatValidateInput>({
    resolver: zodResolver(satValidateSchema),
    defaultValues: { uuid: "", rfc_emisor: "", rfc_receptor: "", total: 0 },
  });

  const validateMutation = useMutation({
    mutationFn: (data: SatValidateInput) => api.sat.validate(data),
    onSuccess: (result: ValidationResult) => {
      setValidationResult(result);
      toast.success("Validacion completada");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Error al validar CFDI");
    },
  });

  const onValidateSubmit = useCallback(
    (data: SatValidateInput) => {
      setValidationResult(null);
      validateMutation.mutate(data);
    },
    [validateMutation],
  );

  /* ================================================================ */
  /* Tab 2 - Validacion Masiva                                        */
  /* ================================================================ */

  const bulkValidateMutation = useMutation({
    mutationFn: () => api.sat.validateBulk(),
    onMutate: () => {
      setBulkProgress(10);
      setBulkResults([]);
    },
    onSuccess: (result: { results?: BulkValidationResult[]; total?: number }) => {
      setBulkProgress(100);
      const results = (result as any).results ?? result ?? [];
      setBulkResults(Array.isArray(results) ? results : []);
      toast.success("Validacion masiva completada");
    },
    onError: (err: Error) => {
      setBulkProgress(0);
      toast.error(err.message || "Error en validacion masiva");
    },
  });

  const filteredBulkResults = useMemo(() => {
    if (!showOnlyChanges) return bulkResults;
    return bulkResults.filter((r) => r.changed);
  }, [bulkResults, showOnlyChanges]);

  const bulkColumns: ColumnDef<BulkValidationResult>[] = useMemo(
    () => [
      {
        accessorKey: "uuid",
        header: "UUID",
        cell: ({ row }) => (
          <span className="font-mono text-xs max-w-[160px] truncate block">
            {row.original.uuid}
          </span>
        ),
      },
      {
        accessorKey: "emisor",
        header: "Emisor",
        cell: ({ row }) => (
          <span className="text-sm">{row.original.emisor || "-"}</span>
        ),
      },
      {
        accessorKey: "estado_anterior",
        header: "Estado Anterior",
        cell: ({ row }) => (
          <SatStatusBadge status={row.original.estado_anterior} />
        ),
      },
      {
        accessorKey: "estado_nuevo",
        header: "Estado Nuevo",
        cell: ({ row }) => (
          <SatStatusBadge status={row.original.estado_nuevo} />
        ),
      },
      {
        accessorKey: "efos_status",
        header: "EFOS",
        cell: ({ row }) => <EfosBadge status={row.original.efos_status} />,
      },
      {
        id: "cambio",
        header: "Cambio?",
        cell: ({ row }) =>
          row.original.changed ? (
            <Badge variant="destructive">Si</Badge>
          ) : (
            <Badge variant="outline">No</Badge>
          ),
      },
    ],
    [],
  );

  /* ================================================================ */
  /* Tab 3 - Documentos CFDI                                          */
  /* ================================================================ */

  const documentsQuery = useQuery({
    queryKey: ["sat", "documents", search],
    queryFn: () => api.sat.documents(search ? { search } : undefined),
    staleTime: 30_000,
  });

  const documents = (documentsQuery.data ?? []) as CfdiDocument[];

  const documentColumns: ColumnDef<CfdiDocument>[] = useMemo(
    () => [
      {
        accessorKey: "uuid",
        header: "UUID",
        cell: ({ row }) => (
          <span className="font-mono text-xs max-w-[160px] truncate block">
            {row.original.uuid || "-"}
          </span>
        ),
      },
      {
        id: "emisor",
        header: "Emisor",
        cell: ({ row }) => (
          <div>
            <p className="text-sm truncate max-w-[150px]">
              {row.original.nombre_emisor || "-"}
            </p>
            <p className="font-mono text-xs text-muted-foreground">
              {row.original.rfc_emisor || ""}
            </p>
          </div>
        ),
      },
      {
        id: "receptor",
        header: "Receptor",
        cell: ({ row }) => (
          <div>
            <p className="text-sm truncate max-w-[150px]">
              {row.original.nombre_receptor || "-"}
            </p>
            <p className="font-mono text-xs text-muted-foreground">
              {row.original.rfc_receptor || ""}
            </p>
          </div>
        ),
      },
      {
        accessorKey: "tipo_comprobante",
        header: "Tipo",
        cell: ({ row }) => {
          const tipo = row.original.tipo_comprobante;
          const label = tipo ? TIPO_COMPROBANTE[tipo] || tipo : "-";
          const colors: Record<string, string> = {
            I: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
            E: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
            P: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
            N: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
            T: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
          };
          return tipo ? (
            <Badge variant="outline" className={colors[tipo] || ""}>
              {tipo} - {label}
            </Badge>
          ) : (
            <span className="text-muted-foreground">-</span>
          );
        },
      },
      {
        accessorKey: "total",
        header: "Total",
        cell: ({ row }) => (
          <span className="font-mono text-sm">
            {row.original.total != null
              ? formatMoney(row.original.total)
              : "-"}
          </span>
        ),
      },
      {
        accessorKey: "fecha_emision",
        header: "Fecha",
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {row.original.fecha_emision
              ? formatDate(row.original.fecha_emision)
              : row.original.fecha_timbrado
                ? formatDate(row.original.fecha_timbrado)
                : "-"}
          </span>
        ),
      },
      {
        id: "vinculado",
        header: "Vinculado?",
        cell: ({ row }) =>
          row.original.invoice_id ? (
            <Badge
              variant="outline"
              className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
            >
              <LinkIcon className="mr-1 size-3" />
              Si
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              No
            </Badge>
          ),
      },
      {
        id: "acciones",
        header: "Acciones",
        enableSorting: false,
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                Acciones
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>
                <Eye className="mr-2 size-4" />
                Ver Detalle
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Download className="mr-2 size-4" />
                Descargar XML
              </DropdownMenuItem>
              {!row.original.invoice_id && (
                <DropdownMenuItem
                  onClick={() => {
                    setVincularDoc(row.original);
                    setVincularOpen(true);
                  }}
                >
                  <LinkIcon className="mr-2 size-4" />
                  Vincular
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [],
  );

  /* ---- Semaforo visual helpers ---- */

  function renderSemaforoIcon() {
    if (!validationResult) return null;
    const color = getSemaforoColor(validationResult);
    return (
      <div className="flex flex-col items-center gap-1.5">
        <div
          className={`size-14 rounded-full ${SEMAFORO_BG[color]} ring-4 ${SEMAFORO_RING[color]} ring-offset-2 ring-offset-background flex items-center justify-center`}
        >
          {color === "green" && (
            <CheckCircle2 className="size-8 text-white" />
          )}
          {color === "yellow" && (
            <AlertTriangle className="size-8 text-white" />
          )}
          {color === "red" && <XCircle className="size-8 text-white" />}
        </div>
        <span className="text-xs font-medium capitalize">{color === "green" ? "Valido" : color === "yellow" ? "Alerta" : "Invalido"}</span>
      </div>
    );
  }

  /* ================================================================ */
  /* Render                                                            */
  /* ================================================================ */

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">SAT / CFDI</h1>
        <p className="text-muted-foreground text-sm">
          Validacion de CFDI, verificacion masiva y gestion de documentos
          fiscales.
        </p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="validar">
            <Search className="mr-1.5 size-4" />
            Validar CFDI
          </TabsTrigger>
          <TabsTrigger value="masiva">
            <RefreshCw className="mr-1.5 size-4" />
            Validacion Masiva
          </TabsTrigger>
          <TabsTrigger value="documentos">
            <FileText className="mr-1.5 size-4" />
            Documentos CFDI
          </TabsTrigger>
        </TabsList>

        {/* ============================================================ */}
        {/* Tab 1: Validar CFDI                                          */}
        {/* ============================================================ */}
        <TabsContent value="validar">
          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Validar CFDI Individual</CardTitle>
                <CardDescription>
                  Verifica el estado de un CFDI ante el SAT, incluyendo
                  verificacion EFOS (Lista 69-B).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...validateForm}>
                  <form
                    onSubmit={validateForm.handleSubmit(onValidateSubmit)}
                    className="grid gap-4"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={validateForm.control}
                        name="uuid"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>UUID</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
                                className="font-mono"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={validateForm.control}
                        name="total"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Total</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="0.00"
                                {...field}
                                onChange={(e) =>
                                  field.onChange(
                                    parseFloat(e.target.value) || 0,
                                  )
                                }
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={validateForm.control}
                        name="rfc_emisor"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>RFC Emisor</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="XAXX010101000"
                                className="font-mono uppercase"
                                {...field}
                                onChange={(e) =>
                                  field.onChange(e.target.value.toUpperCase())
                                }
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={validateForm.control}
                        name="rfc_receptor"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>RFC Receptor</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="XAXX010101000"
                                className="font-mono uppercase"
                                {...field}
                                onChange={(e) =>
                                  field.onChange(e.target.value.toUpperCase())
                                }
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="flex justify-end">
                      <Button
                        type="submit"
                        disabled={validateMutation.isPending}
                      >
                        {validateMutation.isPending ? (
                          <Loader2 className="mr-2 size-4 animate-spin" />
                        ) : (
                          <Search className="mr-2 size-4" />
                        )}
                        Validar
                      </Button>
                    </div>
                  </form>
                </Form>
              </CardContent>
            </Card>

            {/* Validation Result with Semaforo */}
            {validationResult && (
              <Card
                className={
                  SEMAFORO_STYLES[getSemaforoColor(validationResult)]
                }
              >
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    Resultado de Validacion
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-start gap-6">
                    {/* Semaforo visual */}
                    {renderSemaforoIcon()}

                    {/* Details grid */}
                    <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground mb-1">Estado SAT</p>
                        <SatStatusBadge
                          status={validationResult.estado || ""}
                        />
                      </div>
                      <div>
                        <p className="text-muted-foreground mb-1">
                          Es Cancelable
                        </p>
                        <p className="font-medium">
                          {validationResult.esCancelable || "-"}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground mb-1">EFOS</p>
                        <EfosBadge
                          status={validationResult.efosStatus || ""}
                        />
                        {validationResult.efosCode && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Codigo: {validationResult.efosCode}
                          </p>
                        )}
                      </div>
                      <div>
                        <p className="text-muted-foreground mb-1">
                          Fecha Timbrado
                        </p>
                        <p className="font-medium text-xs font-mono">
                          {validationResult.fechaTimbrado
                            ? formatDate(validationResult.fechaTimbrado)
                            : "-"}
                        </p>
                      </div>
                    </div>
                  </div>

                  {validationResult.hasEfosIssue && (
                    <div className="mt-4 p-3 bg-red-100 dark:bg-red-900 rounded-md text-sm text-red-700 dark:text-red-300">
                      <ShieldAlert className="inline size-4 mr-1" />
                      ALERTA: Emisor con estatus EFOS problematico.
                      {(validationResult.efosStatus === "definitive" ||
                        validationResult.efosStatus === "203") &&
                        " Facturas NO deducibles."}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* ============================================================ */}
        {/* Tab 2: Validacion Masiva                                     */}
        {/* ============================================================ */}
        <TabsContent value="masiva">
          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Validacion Masiva</CardTitle>
                <CardDescription>
                  Valida todas las facturas registradas contra el SAT. Se
                  verificara el estado CFDI y EFOS de cada una.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <Button
                    onClick={() => bulkValidateMutation.mutate()}
                    disabled={bulkValidateMutation.isPending}
                    size="lg"
                  >
                    {bulkValidateMutation.isPending ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 size-4" />
                    )}
                    Validar Todas las Facturas
                  </Button>

                  {bulkResults.length > 0 && (
                    <div className="flex items-center gap-2">
                      <Label htmlFor="show-changes" className="text-sm">
                        Solo mostrar cambios
                      </Label>
                      <Switch
                        id="show-changes"
                        checked={showOnlyChanges}
                        onCheckedChange={setShowOnlyChanges}
                      />
                    </div>
                  )}
                </div>

                {bulkValidateMutation.isPending && (
                  <div className="mt-4 space-y-2">
                    <Progress value={bulkProgress} />
                    <p className="text-xs text-muted-foreground text-center">
                      Validando{" "}
                      {bulkProgress < 100
                        ? `${Math.round((bulkProgress / 100) * (bulkResults.length || 1))}/${bulkResults.length || "N"}`
                        : "completado"}
                      ...
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {bulkResults.length > 0 && (
              <DataTable
                columns={bulkColumns}
                data={filteredBulkResults}
                isLoading={bulkValidateMutation.isPending}
                emptyState={
                  <EmptyState
                    icon={Search}
                    title="Sin resultados"
                    description={
                      showOnlyChanges
                        ? "No se detectaron cambios en la validacion."
                        : "No hay resultados de validacion masiva."
                    }
                  />
                }
              />
            )}
          </div>
        </TabsContent>

        {/* ============================================================ */}
        {/* Tab 3: Documentos CFDI                                       */}
        {/* ============================================================ */}
        <TabsContent value="documentos">
          <DataTable
            columns={documentColumns}
            data={documents}
            isLoading={documentsQuery.isLoading}
            toolbar={
              <div className="flex items-center justify-between gap-4">
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder="Buscar por UUID, RFC o emisor..."
                  className="w-full max-w-sm"
                />
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setUploadDialogOpen(true)}
                  >
                    <Upload className="mr-2 size-4" />
                    Subir XML
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setDescargaDialogOpen(true)}
                  >
                    <Download className="mr-2 size-4" />
                    Descarga Masiva SAT
                  </Button>
                </div>
              </div>
            }
            emptyState={
              <EmptyState
                icon={FileText}
                title="Sin documentos CFDI"
                description="No hay documentos CFDI registrados. Sube un XML o solicita una descarga masiva."
                action={{
                  label: "Subir XML",
                  onClick: () => setUploadDialogOpen(true),
                }}
              />
            }
          />
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <UploadXmlDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
      />
      <DescargaMasivaDialog
        open={descargaDialogOpen}
        onOpenChange={setDescargaDialogOpen}
      />
      <VincularDialog
        open={vincularOpen}
        onOpenChange={setVincularOpen}
        document={vincularDoc}
      />
    </div>
  );
}
