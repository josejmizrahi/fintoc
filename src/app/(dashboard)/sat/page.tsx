"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import {
  TIPO_COMPROBANTE,
  FORMA_PAGO,
  EFOS_CODES,
} from "@/lib/sat";
import {
  FileText,
  Search,
  Upload,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldAlert,
  Download,
  Ban,
  Shield,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/* ---------- helpers ---------- */

function formatMXN(amount: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(amount);
}

function formatDate(dateStr?: string) {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function satStatusBadge(status: string) {
  const n = status?.toLowerCase() || "";
  if (n === "vigente") return <Badge variant="default" className="bg-green-600 hover:bg-green-700 text-white">Vigente</Badge>;
  if (n === "cancelado") return <Badge variant="destructive">Cancelado</Badge>;
  if (n === "no encontrado") return <Badge variant="secondary" className="bg-yellow-500 hover:bg-yellow-600 text-white">No encontrado</Badge>;
  return <Badge variant="outline">{status || "Desconocido"}</Badge>;
}

function efosStatusBadge(status: string) {
  if (!status || status === "unknown") return <Badge variant="outline">Sin verificar</Badge>;
  if (status === "clean") return <Badge variant="default" className="bg-green-600 text-white">Limpio</Badge>;
  if (status === "presumed") return <Badge variant="secondary" className="bg-yellow-500 text-white">Presunto</Badge>;
  if (status === "definitive") return <Badge variant="destructive">Definitivo</Badge>;
  if (status === "disproved") return <Badge variant="default" className="bg-blue-600 text-white">Desvirtuado</Badge>;
  if (status === "favorable") return <Badge variant="default" className="bg-blue-600 text-white">Favorable</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function tipoComprobanteBadge(tipo: string) {
  const label = TIPO_COMPROBANTE[tipo] || tipo;
  const colors: Record<string, string> = { I: "bg-blue-100 text-blue-800", E: "bg-orange-100 text-orange-800", P: "bg-purple-100 text-purple-800", N: "bg-gray-100 text-gray-800", T: "bg-cyan-100 text-cyan-800" };
  return <Badge variant="outline" className={colors[tipo] || ""}>{tipo} - {label}</Badge>;
}

/* ---------- Main Page ---------- */

export default function SATPage() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [revalidating, setRevalidating] = useState(false);
  const [valUuid, setValUuid] = useState("");
  const [valRfcEmisor, setValRfcEmisor] = useState("");
  const [valRfcReceptor, setValRfcReceptor] = useState("");
  const [valTotal, setValTotal] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<any | null>(null);
  const [bulkUuids, setBulkUuids] = useState("");
  const [bulkValidating, setBulkValidating] = useState(false);
  const [bulkResults, setBulkResults] = useState<any | null>(null);
  const [xmlContent, setXmlContent] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<any | null>(null);
  const [efosData, setEfosData] = useState<any | null>(null);
  const [efosLoading, setEfosLoading] = useState(false);
  const [rfcInput, setRfcInput] = useState("");
  const [rfcValidating, setRfcValidating] = useState(false);
  const [rfcResult, setRfcResult] = useState<any | null>(null);
  const [descargaFechaInicio, setDescargaFechaInicio] = useState("");
  const [descargaFechaFin, setDescargaFechaFin] = useState("");
  const [descargaTipo, setDescargaTipo] = useState("recibidos");
  const [descargaSolicitud, setDescargaSolicitud] = useState("CFDI");
  const [descargaTipoComp, setDescargaTipoComp] = useState("");
  const [descargaLoading, setDescargaLoading] = useState(false);
  const [descargaRequests, setDescargaRequests] = useState<any[]>([]);
  const [cancelUuid, setCancelUuid] = useState("");
  const [cancelMotivo, setCancelMotivo] = useState("");
  const [cancelUuidSust, setCancelUuidSust] = useState("");
  const [cancelling, setCancelling] = useState(false);

  async function fetchDocuments() {
    setDocsLoading(true);
    try { setDocuments(await api.sat.documents()); } catch (err: any) { toast.error(err.message || "Error al cargar documentos SAT"); } finally { setDocsLoading(false); }
  }
  async function fetchEfosRisk() {
    setEfosLoading(true);
    try { setEfosData(await api.sat.efosRisk()); } catch { /* might not be available */ } finally { setEfosLoading(false); }
  }
  async function fetchDescargaRequests() {
    try { setDescargaRequests(await api.sat.descargaRequests()); } catch { /* might not be available */ }
  }

  useEffect(() => { fetchDocuments(); fetchEfosRisk(); fetchDescargaRequests(); }, []);

  async function handleRevalidateAll() {
    setRevalidating(true);
    try {
      const r = await api.sat.revalidateAll();
      toast.success(`Revalidacion: ${r.vigentes || 0} vigentes, ${r.cancelados || 0} cancelados, ${r.efos_issues || 0} EFOS`);
      fetchDocuments(); fetchEfosRisk();
    } catch (err: any) { toast.error(err.message || "Error al revalidar"); } finally { setRevalidating(false); }
  }

  async function handleValidate(e: React.FormEvent) {
    e.preventDefault();
    if (!valUuid || !valRfcEmisor || !valRfcReceptor || !valTotal) { toast.error("Completa todos los campos"); return; }
    setValidating(true); setValidationResult(null);
    try { const r = await api.sat.validateFull({ uuid: valUuid, rfc_emisor: valRfcEmisor, rfc_receptor: valRfcReceptor, total: parseFloat(valTotal) }); setValidationResult(r); toast.success("Validacion completada"); }
    catch (err: any) { toast.error(err.message || "Error al validar CFDI"); } finally { setValidating(false); }
  }

  async function handleBulkValidate() {
    const uuids = bulkUuids.split("\n").map(u => u.trim()).filter(Boolean);
    if (uuids.length === 0) { toast.error("Ingresa al menos un UUID"); return; }
    setBulkValidating(true); setBulkResults(null);
    try { const r = await api.sat.validateBulk({ uuids }); setBulkResults(r); toast.success(`Validacion masiva: ${uuids.length} UUID(s)`); }
    catch (err: any) { toast.error(err.message || "Error en validacion masiva"); } finally { setBulkValidating(false); }
  }

  async function handleUploadXml() {
    if (!xmlContent.trim()) { toast.error("Ingresa el contenido XML"); return; }
    setUploading(true); setUploadResult(null);
    try { const r = await api.sat.uploadXml({ xml_content: xmlContent }); setUploadResult(r); toast.success("XML procesado exitosamente"); fetchDocuments(); }
    catch (err: any) { toast.error(err.message || "Error al subir XML"); } finally { setUploading(false); }
  }

  async function handleValidateRfc() {
    if (!rfcInput.trim()) { toast.error("Ingresa un RFC"); return; }
    setRfcValidating(true); setRfcResult(null);
    try { const r = await api.sat.validateRfc({ rfc: rfcInput.trim() }); setRfcResult(r); toast.success(r.valid ? "RFC valido" : "RFC invalido"); }
    catch (err: any) { toast.error(err.message || "Error al validar RFC"); } finally { setRfcValidating(false); }
  }

  async function handleDescargaSolicitud_() {
    if (!descargaFechaInicio || !descargaFechaFin) { toast.error("Selecciona fechas"); return; }
    setDescargaLoading(true);
    try {
      const r = await api.sat.descargaSolicitud({ request_type: descargaTipo, solicitud_type: descargaSolicitud, fecha_inicio: `${descargaFechaInicio}T00:00:00`, fecha_fin: `${descargaFechaFin}T23:59:59`, tipo_comprobante: descargaTipoComp || undefined });
      toast.success(r.message || "Solicitud creada"); fetchDescargaRequests();
    } catch (err: any) { toast.error(err.message || "Error al crear solicitud"); } finally { setDescargaLoading(false); }
  }

  async function handleCancelar() {
    if (!cancelUuid || !cancelMotivo) { toast.error("UUID y motivo son requeridos"); return; }
    setCancelling(true);
    try {
      const r = await api.sat.cancelar({ uuid: cancelUuid, motivo: cancelMotivo, uuid_sustitucion: cancelUuidSust || undefined });
      toast.success(r.message || "Solicitud creada"); setCancelUuid(""); setCancelMotivo(""); setCancelUuidSust("");
    } catch (err: any) { toast.error(err.message || "Error al cancelar"); } finally { setCancelling(false); }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">SAT / CFDI</h1>
          <p className="text-muted-foreground text-sm">Gestion completa: validacion, EFOS, descarga masiva y cancelacion.</p>
        </div>
        <Button onClick={handleRevalidateAll} disabled={revalidating}>
          {revalidating ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}
          Revalidar Todo
        </Button>
      </div>

      {efosData && (efosData.vendors_at_risk > 0 || efosData.invoices_at_risk > 0) && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-red-700 dark:text-red-400">
              <ShieldAlert className="size-5" /> Alerta EFOS - Riesgo de Facturacion Simulada
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div><p className="text-muted-foreground">Proveedores en riesgo</p><p className="text-2xl font-bold text-red-600">{efosData.vendors_at_risk}</p></div>
              <div><p className="text-muted-foreground">Facturas en riesgo</p><p className="text-2xl font-bold text-red-600">{efosData.invoices_at_risk}</p></div>
              <div><p className="text-muted-foreground">Monto NO deducible</p><p className="text-2xl font-bold text-red-600">{formatMXN(efosData.non_deductible_amount || 0)}</p><p className="text-xs text-muted-foreground">EFOS 203</p></div>
              <div><p className="text-muted-foreground">Monto en riesgo</p><p className="text-2xl font-bold text-yellow-600">{formatMXN(efosData.at_risk_amount || 0)}</p><p className="text-xs text-muted-foreground">EFOS 201</p></div>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="documentos">
        <TabsList className="flex-wrap">
          <TabsTrigger value="documentos"><FileText className="mr-1.5 size-4" />Documentos</TabsTrigger>
          <TabsTrigger value="validar"><Search className="mr-1.5 size-4" />Validar</TabsTrigger>
          <TabsTrigger value="subir"><Upload className="mr-1.5 size-4" />Subir XML</TabsTrigger>
          <TabsTrigger value="efos"><Shield className="mr-1.5 size-4" />EFOS</TabsTrigger>
          <TabsTrigger value="descarga"><Download className="mr-1.5 size-4" />Descarga Masiva</TabsTrigger>
          <TabsTrigger value="cancelacion"><Ban className="mr-1.5 size-4" />Cancelacion</TabsTrigger>
        </TabsList>

        {/* Documents */}
        <TabsContent value="documentos">
          <Card>
            <CardHeader><CardTitle>Documentos CFDI</CardTitle><CardDescription>Comprobantes fiscales con estado SAT y EFOS.</CardDescription></CardHeader>
            <CardContent>
              {docsLoading ? <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
              : documents.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No hay documentos CFDI registrados.</p>
              : <div className="overflow-x-auto"><Table><TableHeader><TableRow>
                <TableHead>UUID</TableHead><TableHead>Tipo</TableHead><TableHead>RFC Emisor</TableHead><TableHead>Emisor</TableHead>
                <TableHead className="text-right">Total</TableHead><TableHead>Moneda</TableHead><TableHead>Estado SAT</TableHead>
                <TableHead>EFOS</TableHead><TableHead>Metodo</TableHead><TableHead>Fecha</TableHead>
              </TableRow></TableHeader><TableBody>
                {documents.map((doc, idx) => (
                  <TableRow key={doc.uuid || idx}>
                    <TableCell className="font-mono text-xs max-w-[160px] truncate">{doc.uuid || "-"}</TableCell>
                    <TableCell>{doc.tipo_comprobante ? tipoComprobanteBadge(doc.tipo_comprobante) : "-"}</TableCell>
                    <TableCell className="font-mono text-sm">{doc.rfc_emisor || "-"}</TableCell>
                    <TableCell className="max-w-[150px] truncate">{doc.nombre_emisor || "-"}</TableCell>
                    <TableCell className="text-right font-mono">{doc.total != null ? formatMXN(doc.total) : "-"}</TableCell>
                    <TableCell className="text-sm">{doc.moneda || "MXN"}</TableCell>
                    <TableCell>{satStatusBadge(doc.sat_status || doc.estado || "")}</TableCell>
                    <TableCell>{efosStatusBadge(doc.efos_status || "")}</TableCell>
                    <TableCell className="text-sm">{doc.metodo_pago || "-"}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{formatDate(doc.fecha_emision || doc.fecha_timbrado)}</TableCell>
                  </TableRow>
                ))}
              </TableBody></Table></div>}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Validar */}
        <TabsContent value="validar">
          <div className="grid gap-6">
            <Card>
              <CardHeader><CardTitle>Validacion Individual (con EFOS)</CardTitle><CardDescription>Verifica estado CFDI incluyendo Lista 69-B.</CardDescription></CardHeader>
              <CardContent>
                <form onSubmit={handleValidate} className="grid gap-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="grid gap-2"><Label>UUID</Label><Input placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX" value={valUuid} onChange={e => setValUuid(e.target.value)} /></div>
                    <div className="grid gap-2"><Label>Total</Label><Input type="number" step="0.01" min="0" placeholder="0.00" value={valTotal} onChange={e => setValTotal(e.target.value)} /></div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="grid gap-2"><Label>RFC Emisor</Label><Input placeholder="XAXX010101000" value={valRfcEmisor} onChange={e => setValRfcEmisor(e.target.value)} /></div>
                    <div className="grid gap-2"><Label>RFC Receptor</Label><Input placeholder="XAXX010101000" value={valRfcReceptor} onChange={e => setValRfcReceptor(e.target.value)} /></div>
                  </div>
                  <div className="flex justify-end"><Button type="submit" disabled={validating}>{validating ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Search className="mr-2 size-4" />}Validar</Button></div>
                </form>
                {validationResult && (<><Separator className="my-4" /><Card className="bg-muted/50"><CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2">
                  {validationResult.isValid ? <CheckCircle2 className="size-5 text-green-600" /> : validationResult.estado === "Cancelado" ? <XCircle className="size-5 text-red-600" /> : <AlertTriangle className="size-5 text-yellow-600" />}
                  Resultado
                </CardTitle></CardHeader><CardContent><div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div><p className="text-muted-foreground">Estado</p>{satStatusBadge(validationResult.estado || "")}</div>
                  <div><p className="text-muted-foreground">EFOS</p>{efosStatusBadge(validationResult.efosStatus || "")}{validationResult.efosCode && <p className="text-xs text-muted-foreground mt-1">Codigo: {validationResult.efosCode}</p>}</div>
                  <div><p className="text-muted-foreground">Cancelable</p><p>{validationResult.esCancelable || "-"}</p></div>
                  <div><p className="text-muted-foreground">Est. Cancelacion</p><p>{validationResult.estatusCancelacion || "-"}</p></div>
                </div>
                {validationResult.hasEfosIssue && <div className="mt-4 p-3 bg-red-100 dark:bg-red-900 rounded-md text-sm text-red-700 dark:text-red-300"><ShieldAlert className="inline size-4 mr-1" />ALERTA: Emisor con estatus EFOS problematico.{validationResult.efosStatus === "definitive" && " Facturas NO deducibles."}</div>}
                </CardContent></Card></>)}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Validacion Masiva</CardTitle><CardDescription>Un UUID por linea.</CardDescription></CardHeader>
              <CardContent><div className="grid gap-4">
                <Textarea placeholder={"UUID-1\nUUID-2"} value={bulkUuids} onChange={e => setBulkUuids(e.target.value)} rows={6} className="font-mono text-sm" />
                <div className="flex justify-end"><Button onClick={handleBulkValidate} disabled={bulkValidating}>{bulkValidating ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Search className="mr-2 size-4" />}Validar</Button></div>
                {bulkResults && (<><Separator /><Table><TableHeader><TableRow><TableHead>UUID</TableHead><TableHead>Estado</TableHead><TableHead>EFOS</TableHead></TableRow></TableHeader><TableBody>
                  {(bulkResults.results || []).map((r: any, i: number) => <TableRow key={i}><TableCell className="font-mono text-xs">{r.uuid}</TableCell><TableCell>{satStatusBadge(r.estado || "")}</TableCell><TableCell>{efosStatusBadge(r.efos_status || "")}</TableCell></TableRow>)}
                </TableBody></Table></>)}
              </div></CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Validacion de RFC</CardTitle><CardDescription>Verifica formato RFC.</CardDescription></CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Input placeholder="RFC" value={rfcInput} onChange={e => setRfcInput(e.target.value)} className="font-mono" />
                  <Button onClick={handleValidateRfc} disabled={rfcValidating}>{rfcValidating ? <Loader2 className="size-4 animate-spin" /> : "Validar"}</Button>
                </div>
                {rfcResult && <div className={`mt-3 p-3 rounded-md text-sm ${rfcResult.valid ? "bg-green-50 text-green-700 dark:bg-green-900 dark:text-green-300" : "bg-red-50 text-red-700 dark:bg-red-900 dark:text-red-300"}`}>
                  <p className="font-medium">{rfcResult.rfc}: {rfcResult.valid ? "Valido" : "Invalido"}</p>
                  {rfcResult.valid && <p className="text-xs mt-1">Tipo: {rfcResult.type === "moral" ? "Persona Moral" : rfcResult.type === "fisica" ? "Persona Fisica" : rfcResult.type}</p>}
                </div>}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Subir XML */}
        <TabsContent value="subir">
          <Card>
            <CardHeader><CardTitle>Subir XML CFDI</CardTitle><CardDescription>Se extraen TODOS los campos del Anexo 20.</CardDescription></CardHeader>
            <CardContent><div className="grid gap-4">
              <Textarea placeholder={'<?xml version="1.0"?>\n<cfdi:Comprobante ...>'} value={xmlContent} onChange={e => setXmlContent(e.target.value)} rows={12} className="font-mono text-sm" />
              <div className="grid gap-2"><Label>O selecciona un archivo</Label><Input type="file" accept=".xml" onChange={e => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onload = ev => setXmlContent(ev.target?.result as string || ""); r.readAsText(f); } }} /></div>
              <div className="flex justify-end"><Button onClick={handleUploadXml} disabled={uploading}>{uploading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Upload className="mr-2 size-4" />}Subir XML</Button></div>
              {uploadResult && (<><Separator /><Card className="bg-muted/50"><CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><CheckCircle2 className="size-5 text-green-600" />XML Procesado</CardTitle></CardHeader><CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div><p className="text-muted-foreground">UUID</p><p className="font-mono text-xs break-all">{uploadResult.uuid || "-"}</p></div>
                  <div><p className="text-muted-foreground">Tipo</p><p>{uploadResult.tipo_comprobante_label || uploadResult.tipo_comprobante || "-"}</p></div>
                  <div><p className="text-muted-foreground">Total</p><p className="font-mono">{uploadResult.total != null ? `${formatMXN(uploadResult.total)} ${uploadResult.moneda || "MXN"}` : "-"}</p></div>
                  <div><p className="text-muted-foreground">SAT</p>{satStatusBadge(uploadResult.estado || "")}</div>
                  <div><p className="text-muted-foreground">EFOS</p>{efosStatusBadge(uploadResult.efos_status || "")}</div>
                  <div><p className="text-muted-foreground">Metodo</p><p>{uploadResult.metodo_pago || "-"}</p></div>
                  <div><p className="text-muted-foreground">Forma</p><p>{FORMA_PAGO[uploadResult.forma_pago] || uploadResult.forma_pago || "-"}</p></div>
                  <div><p className="text-muted-foreground">Conceptos</p><p>{uploadResult.conceptos_count || 0} lineas</p></div>
                </div>
                {uploadResult.has_complemento_pago && <div className="mt-3 p-2 bg-purple-50 dark:bg-purple-900 rounded text-sm text-purple-700 dark:text-purple-300">Contiene Complemento de Pago</div>}
                {!uploadResult.efos_safe && <div className="mt-3 p-2 bg-red-50 dark:bg-red-900 rounded text-sm text-red-700 dark:text-red-300"><ShieldAlert className="inline size-4 mr-1" />ALERTA EFOS: Emisor con estatus problematico</div>}
              </CardContent></Card></>)}
            </div></CardContent>
          </Card>
        </TabsContent>

        {/* EFOS */}
        <TabsContent value="efos">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="size-5" />Dashboard EFOS (Lista 69-B)</CardTitle><CardDescription>Monitoreo de riesgo de facturacion simulada.</CardDescription></CardHeader>
            <CardContent>
              {efosLoading ? <div className="flex items-center justify-center py-8"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
              : !efosData ? <p className="py-8 text-center text-sm text-muted-foreground">No hay datos EFOS.</p>
              : <>
                <div className="mb-6"><h3 className="font-medium mb-2 text-sm">Codigos EFOS del SAT</h3>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                  {Object.entries(EFOS_CODES).map(([code, info]) => <div key={code} className={`p-2 rounded text-xs ${info.safe ? "bg-green-50 dark:bg-green-900/30" : "bg-red-50 dark:bg-red-900/30"}`}><span className="font-mono font-bold">{code}</span> - {info.label}</div>)}
                </div></div>
                <Separator className="my-4" />
                {efosData.risky_vendors?.length > 0 && <div className="mb-6"><h3 className="font-medium mb-2">Proveedores en Lista 69-B</h3><Table><TableHeader><TableRow><TableHead>Proveedor</TableHead><TableHead>RFC</TableHead><TableHead>EFOS</TableHead><TableHead>Verificacion</TableHead></TableRow></TableHeader><TableBody>
                  {efosData.risky_vendors.map((v: any) => <TableRow key={v.id}><TableCell>{v.name}</TableCell><TableCell className="font-mono">{v.rfc}</TableCell><TableCell>{efosStatusBadge(v.efos_status)}</TableCell><TableCell className="text-muted-foreground">{formatDate(v.efos_checked_at)}</TableCell></TableRow>)}
                </TableBody></Table></div>}
                {efosData.risky_invoices?.length > 0 && <div><h3 className="font-medium mb-2">Facturas en riesgo</h3><Table><TableHeader><TableRow><TableHead>UUID</TableHead><TableHead>Proveedor</TableHead><TableHead>RFC</TableHead><TableHead className="text-right">Monto</TableHead><TableHead>EFOS</TableHead></TableRow></TableHeader><TableBody>
                  {efosData.risky_invoices.map((i: any) => <TableRow key={i.id}><TableCell className="font-mono text-xs max-w-[160px] truncate">{i.cfdi_uuid}</TableCell><TableCell>{i.partner_name}</TableCell><TableCell className="font-mono text-sm">{i.partner_rfc}</TableCell><TableCell className="text-right font-mono">{formatMXN(i.amount_total || 0)}</TableCell><TableCell>{efosStatusBadge(i.efos_status)}</TableCell></TableRow>)}
                </TableBody></Table></div>}
                {efosData.vendors_at_risk === 0 && efosData.invoices_at_risk === 0 && <div className="py-8 text-center"><CheckCircle2 className="size-12 text-green-600 mx-auto mb-2" /><p className="text-sm text-muted-foreground">Sin riesgos EFOS detectados.</p></div>}
              </>}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Descarga Masiva */}
        <TabsContent value="descarga">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Download className="size-5" />Descarga Masiva de CFDI (v1.5)</CardTitle><CardDescription>Requiere certificado FIEL configurado.</CardDescription></CardHeader>
            <CardContent><div className="grid gap-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="grid gap-2"><Label>Fecha Inicio</Label><Input type="date" value={descargaFechaInicio} onChange={e => setDescargaFechaInicio(e.target.value)} /></div>
                <div className="grid gap-2"><Label>Fecha Fin</Label><Input type="date" value={descargaFechaFin} onChange={e => setDescargaFechaFin(e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="grid gap-2"><Label>Tipo</Label><Select value={descargaTipo} onValueChange={setDescargaTipo}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="recibidos">Recibidos</SelectItem><SelectItem value="emitidos">Emitidos</SelectItem></SelectContent></Select></div>
                <div className="grid gap-2"><Label>Formato</Label><Select value={descargaSolicitud} onValueChange={setDescargaSolicitud}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="CFDI">XML Completo</SelectItem><SelectItem value="Metadata">Solo Metadata</SelectItem></SelectContent></Select></div>
                <div className="grid gap-2"><Label>Tipo Comprobante</Label><Select value={descargaTipoComp} onValueChange={setDescargaTipoComp}><SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger><SelectContent><SelectItem value="">Todos</SelectItem><SelectItem value="I">Ingreso</SelectItem><SelectItem value="E">Egreso</SelectItem><SelectItem value="P">Pago</SelectItem><SelectItem value="N">Nomina</SelectItem><SelectItem value="T">Traslado</SelectItem></SelectContent></Select></div>
              </div>
              <div className="flex justify-end"><Button onClick={handleDescargaSolicitud_} disabled={descargaLoading}>{descargaLoading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Download className="mr-2 size-4" />}Solicitar</Button></div>
            </div>
            {descargaRequests.length > 0 && (<><Separator className="my-4" /><h3 className="font-medium mb-2">Solicitudes</h3><Table><TableHeader><TableRow><TableHead>ID</TableHead><TableHead>Tipo</TableHead><TableHead>Periodo</TableHead><TableHead>Estado</TableHead><TableHead>CFDIs</TableHead><TableHead>Fecha</TableHead></TableRow></TableHeader><TableBody>
              {descargaRequests.map((r: any) => <TableRow key={r.id}><TableCell>{r.id}</TableCell><TableCell><Badge variant="outline">{r.request_type}/{r.solicitud_type}</Badge></TableCell><TableCell className="text-sm">{formatDate(r.fecha_inicio)} - {formatDate(r.fecha_fin)}</TableCell><TableCell><Badge variant={r.status === "downloaded" ? "default" : r.status === "error" ? "destructive" : "secondary"}>{r.status}</Badge></TableCell><TableCell>{r.num_cfdis || "-"}</TableCell><TableCell className="text-muted-foreground">{formatDate(r.created_at)}</TableCell></TableRow>)}
            </TableBody></Table></>)}</CardContent>
          </Card>
        </TabsContent>

        {/* Cancelacion */}
        <TabsContent value="cancelacion">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Ban className="size-5" />Cancelacion de CFDI</CardTitle><CardDescription>Puede requerir aceptacion del receptor.</CardDescription></CardHeader>
            <CardContent><div className="grid gap-4">
              <div className="grid gap-2"><Label>UUID del CFDI</Label><Input placeholder="UUID" value={cancelUuid} onChange={e => setCancelUuid(e.target.value)} className="font-mono" /></div>
              <div className="grid gap-2"><Label>Motivo</Label><Select value={cancelMotivo} onValueChange={setCancelMotivo}><SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger><SelectContent>
                <SelectItem value="01">01 - Con errores con relacion</SelectItem>
                <SelectItem value="02">02 - Con errores sin relacion</SelectItem>
                <SelectItem value="03">03 - No se realizo la operacion</SelectItem>
                <SelectItem value="04">04 - Nominativa en factura global</SelectItem>
              </SelectContent></Select></div>
              {cancelMotivo === "01" && <div className="grid gap-2"><Label>UUID sustituto</Label><Input placeholder="UUID del nuevo CFDI" value={cancelUuidSust} onChange={e => setCancelUuidSust(e.target.value)} className="font-mono" /></div>}
              <div className="flex justify-end"><Button onClick={handleCancelar} disabled={cancelling} variant="destructive">{cancelling ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Ban className="mr-2 size-4" />}Solicitar Cancelacion</Button></div>
              <Separator />
              <div className="text-sm text-muted-foreground space-y-1">
                <p><strong>Sin aceptacion:</strong> &lt; $1,000 MXN, nomina, egreso, traslado, RFC generico.</p>
                <p><strong>Con aceptacion:</strong> Ingreso &ge; $1,000. Receptor tiene 72h para responder.</p>
              </div>
            </div></CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
