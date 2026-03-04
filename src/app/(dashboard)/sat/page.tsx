"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import {
  FileText,
  Search,
  Upload,
  RefreshCw,
  Loader2,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

type BadgeVariant = "default" | "secondary" | "outline" | "destructive";

function satStatusBadge(status: string) {
  const normalized = status?.toLowerCase() || "";
  if (normalized === "vigente") {
    return (
      <Badge variant="default" className="bg-green-600 hover:bg-green-700 text-white">
        Vigente
      </Badge>
    );
  }
  if (normalized === "cancelado") {
    return <Badge variant="destructive">Cancelado</Badge>;
  }
  if (normalized === "no encontrado") {
    return (
      <Badge variant="secondary" className="bg-yellow-500 hover:bg-yellow-600 text-white">
        No encontrado
      </Badge>
    );
  }
  return <Badge variant="outline">{status || "Desconocido"}</Badge>;
}

/* ---------- Main Page ---------- */

export default function SATPage() {
  /* ---- Documents tab state ---- */
  const [documents, setDocuments] = useState<any[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [revalidating, setRevalidating] = useState(false);

  /* ---- Validate tab state ---- */
  const [valUuid, setValUuid] = useState("");
  const [valRfcEmisor, setValRfcEmisor] = useState("");
  const [valRfcReceptor, setValRfcReceptor] = useState("");
  const [valTotal, setValTotal] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<any | null>(null);

  /* ---- Bulk validation state ---- */
  const [bulkUuids, setBulkUuids] = useState("");
  const [bulkValidating, setBulkValidating] = useState(false);
  const [bulkResults, setBulkResults] = useState<any | null>(null);

  /* ---- Upload XML tab state ---- */
  const [xmlContent, setXmlContent] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<any | null>(null);

  /* ---- Fetch documents ---- */
  async function fetchDocuments() {
    setDocsLoading(true);
    try {
      const data = await api.sat.documents();
      setDocuments(data);
    } catch (err: any) {
      toast.error(err.message || "Error al cargar documentos SAT");
    } finally {
      setDocsLoading(false);
    }
  }

  useEffect(() => {
    fetchDocuments();
  }, []);

  /* ---- Revalidate all ---- */
  async function handleRevalidateAll() {
    setRevalidating(true);
    try {
      await api.sat.revalidateAll();
      toast.success("Revalidacion iniciada para todos los documentos");
      fetchDocuments();
    } catch (err: any) {
      toast.error(err.message || "Error al revalidar");
    } finally {
      setRevalidating(false);
    }
  }

  /* ---- Single validation ---- */
  async function handleValidate(e: React.FormEvent) {
    e.preventDefault();
    if (!valUuid || !valRfcEmisor || !valRfcReceptor || !valTotal) {
      toast.error("Completa todos los campos");
      return;
    }
    setValidating(true);
    setValidationResult(null);
    try {
      const result = await api.sat.validate({
        uuid: valUuid,
        rfc_emisor: valRfcEmisor,
        rfc_receptor: valRfcReceptor,
        total: parseFloat(valTotal),
      });
      setValidationResult(result);
      toast.success("Validacion completada");
    } catch (err: any) {
      toast.error(err.message || "Error al validar CFDI");
    } finally {
      setValidating(false);
    }
  }

  /* ---- Bulk validation ---- */
  async function handleBulkValidate() {
    const uuids = bulkUuids
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean);
    if (uuids.length === 0) {
      toast.error("Ingresa al menos un UUID");
      return;
    }
    setBulkValidating(true);
    setBulkResults(null);
    try {
      const result = await api.sat.validateBulk({ uuids });
      setBulkResults(result);
      toast.success(`Validacion masiva completada: ${uuids.length} UUID(s)`);
    } catch (err: any) {
      toast.error(err.message || "Error en validacion masiva");
    } finally {
      setBulkValidating(false);
    }
  }

  /* ---- Upload XML ---- */
  async function handleUploadXml() {
    if (!xmlContent.trim()) {
      toast.error("Ingresa el contenido XML");
      return;
    }
    setUploading(true);
    setUploadResult(null);
    try {
      const result = await api.sat.uploadXml({ xml_content: xmlContent });
      setUploadResult(result);
      toast.success("XML procesado exitosamente");
      fetchDocuments();
    } catch (err: any) {
      toast.error(err.message || "Error al subir XML");
    } finally {
      setUploading(false);
    }
  }

  /* ---------- render ---------- */

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">SAT / CFDI</h1>
          <p className="text-muted-foreground text-sm">
            Gestion de comprobantes fiscales digitales y validacion ante el SAT.
          </p>
        </div>
        <Button onClick={handleRevalidateAll} disabled={revalidating}>
          {revalidating ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 size-4" />
          )}
          Revalidar Todo
        </Button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="documentos">
        <TabsList>
          <TabsTrigger value="documentos">
            <FileText className="mr-1.5 size-4" />
            Documentos
          </TabsTrigger>
          <TabsTrigger value="validar">
            <Search className="mr-1.5 size-4" />
            Validar
          </TabsTrigger>
          <TabsTrigger value="subir">
            <Upload className="mr-1.5 size-4" />
            Subir XML
          </TabsTrigger>
        </TabsList>

        {/* ---- Tab: Documentos ---- */}
        <TabsContent value="documentos">
          <Card>
            <CardHeader>
              <CardTitle>Documentos CFDI</CardTitle>
              <CardDescription>
                Comprobantes fiscales digitales registrados en el sistema.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {docsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              ) : documents.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No hay documentos CFDI registrados.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>UUID</TableHead>
                      <TableHead>RFC Emisor</TableHead>
                      <TableHead>RFC Receptor</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Fecha Timbrado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {documents.map((doc, idx) => (
                      <TableRow key={doc.uuid || idx}>
                        <TableCell className="font-mono text-xs max-w-[200px] truncate">
                          {doc.uuid || "-"}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {doc.rfc_emisor || "-"}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {doc.rfc_receptor || "-"}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {doc.total != null ? formatMXN(doc.total) : "-"}
                        </TableCell>
                        <TableCell>
                          {satStatusBadge(doc.estado || doc.status || "")}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(doc.fecha_timbrado || doc.stamp_date)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Tab: Validar ---- */}
        <TabsContent value="validar">
          <div className="grid gap-6">
            {/* Single validation */}
            <Card>
              <CardHeader>
                <CardTitle>Validacion Individual</CardTitle>
                <CardDescription>
                  Verifica el estado de un CFDI ante el SAT ingresando sus datos.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleValidate} className="grid gap-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="val-uuid">UUID</Label>
                      <Input
                        id="val-uuid"
                        placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
                        value={valUuid}
                        onChange={(e) => setValUuid(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="val-total">Total</Label>
                      <Input
                        id="val-total"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={valTotal}
                        onChange={(e) => setValTotal(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="val-rfc-emisor">RFC Emisor</Label>
                      <Input
                        id="val-rfc-emisor"
                        placeholder="XAXX010101000"
                        value={valRfcEmisor}
                        onChange={(e) => setValRfcEmisor(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="val-rfc-receptor">RFC Receptor</Label>
                      <Input
                        id="val-rfc-receptor"
                        placeholder="XAXX010101000"
                        value={valRfcReceptor}
                        onChange={(e) => setValRfcReceptor(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={validating}>
                      {validating ? (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      ) : (
                        <Search className="mr-2 size-4" />
                      )}
                      Validar
                    </Button>
                  </div>
                </form>

                {validationResult && (
                  <>
                    <Separator className="my-4" />
                    <Card className="bg-muted/50">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2">
                          {validationResult.estado === "Vigente" ? (
                            <CheckCircle2 className="size-5 text-green-600" />
                          ) : validationResult.estado === "Cancelado" ? (
                            <XCircle className="size-5 text-red-600" />
                          ) : (
                            <AlertTriangle className="size-5 text-yellow-600" />
                          )}
                          Resultado de Validacion
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <p className="text-muted-foreground">Estado</p>
                            <p className="font-medium">{satStatusBadge(validationResult.estado || validationResult.status || "")}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">UUID</p>
                            <p className="font-mono text-xs break-all">{validationResult.uuid || valUuid}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">RFC Emisor</p>
                            <p className="font-mono">{validationResult.rfc_emisor || valRfcEmisor}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Fecha Consulta</p>
                            <p>{validationResult.consulta_date || new Date().toLocaleDateString("es-MX")}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Bulk validation */}
            <Card>
              <CardHeader>
                <CardTitle>Validacion Masiva</CardTitle>
                <CardDescription>
                  Valida multiples CFDI a la vez. Ingresa un UUID por linea.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="bulk-uuids">UUIDs (uno por linea)</Label>
                    <Textarea
                      id="bulk-uuids"
                      placeholder={"XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX\nYYYYYYYY-YYYY-YYYY-YYYY-YYYYYYYYYYYY"}
                      value={bulkUuids}
                      onChange={(e) => setBulkUuids(e.target.value)}
                      rows={6}
                      className="font-mono text-sm"
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button onClick={handleBulkValidate} disabled={bulkValidating}>
                      {bulkValidating ? (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      ) : (
                        <Search className="mr-2 size-4" />
                      )}
                      Validar Masivamente
                    </Button>
                  </div>

                  {bulkResults && (
                    <>
                      <Separator />
                      <Card className="bg-muted/50">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base">Resultados de Validacion Masiva</CardTitle>
                        </CardHeader>
                        <CardContent>
                          {Array.isArray(bulkResults.results || bulkResults) ? (
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>UUID</TableHead>
                                  <TableHead>Estado</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {(bulkResults.results || bulkResults).map((r: any, idx: number) => (
                                  <TableRow key={idx}>
                                    <TableCell className="font-mono text-xs">
                                      {r.uuid || "-"}
                                    </TableCell>
                                    <TableCell>
                                      {satStatusBadge(r.estado || r.status || "")}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          ) : (
                            <div className="text-sm">
                              <p className="text-muted-foreground">
                                Procesados: {bulkResults.processed ?? "-"} | Vigentes: {bulkResults.valid ?? "-"} | Errores: {bulkResults.errors ?? "-"}
                              </p>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ---- Tab: Subir XML ---- */}
        <TabsContent value="subir">
          <Card>
            <CardHeader>
              <CardTitle>Subir XML CFDI</CardTitle>
              <CardDescription>
                Sube el contenido de un comprobante fiscal digital en formato XML.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="xml-content">Contenido XML</Label>
                  <Textarea
                    id="xml-content"
                    placeholder={'<?xml version="1.0" encoding="UTF-8"?>\n<cfdi:Comprobante ...>'}
                    value={xmlContent}
                    onChange={(e) => setXmlContent(e.target.value)}
                    rows={12}
                    className="font-mono text-sm"
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="xml-file">O selecciona un archivo XML</Label>
                  <Input
                    id="xml-file"
                    type="file"
                    accept=".xml"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                          setXmlContent(ev.target?.result as string || "");
                        };
                        reader.readAsText(file);
                      }
                    }}
                  />
                </div>

                <div className="flex justify-end">
                  <Button onClick={handleUploadXml} disabled={uploading}>
                    {uploading ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <Upload className="mr-2 size-4" />
                    )}
                    Subir XML
                  </Button>
                </div>

                {uploadResult && (
                  <>
                    <Separator />
                    <Card className="bg-muted/50">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2">
                          <CheckCircle2 className="size-5 text-green-600" />
                          XML Procesado
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <p className="text-muted-foreground">UUID</p>
                            <p className="font-mono text-xs break-all">{uploadResult.uuid || "-"}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">RFC Emisor</p>
                            <p className="font-mono">{uploadResult.rfc_emisor || "-"}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Total</p>
                            <p className="font-mono">{uploadResult.total != null ? formatMXN(uploadResult.total) : "-"}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Estado</p>
                            <p>{satStatusBadge(uploadResult.estado || uploadResult.status || "")}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
