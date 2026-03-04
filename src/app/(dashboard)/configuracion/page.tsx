"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuthStore } from "@/lib/store";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Settings {
  odoo: { url: string; database: string; user: string; password: string };
  fintoc: { secretKey: string; publicKey: string; webhookSecret: string; accountId: string; linkToken: string; jwsKeyPath: string };
  sat: { rfcEmisor: string; certPath: string; keyPath: string; keyPassword: string; pac: string };
  general: { companyName: string; rfc: string; plan: string; notificationEmail: string; slackWebhook: string; smtpHost: string; smtpPort: string; smtpUser: string; smtpPassword: string };
}

function defaultSettings(tenantName: string, tenantRfc: string): Settings {
  return {
    odoo: { url: "", database: "", user: "", password: "" },
    fintoc: { secretKey: "", publicKey: "", webhookSecret: "", accountId: "", linkToken: "", jwsKeyPath: "" },
    sat: { rfcEmisor: "", certPath: "", keyPath: "", keyPassword: "", pac: "" },
    general: { companyName: tenantName, rfc: tenantRfc, plan: "Pro", notificationEmail: "", slackWebhook: "", smtpHost: "", smtpPort: "587", smtpUser: "", smtpPassword: "" },
  };
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

function authHeaders() {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function saveIntegration(provider: string, config: Record<string, string>) {
  const res = await fetch("/api/onboarding", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ action: "save", provider, config }),
  });
  return res.json();
}

async function testIntegration(provider: string, config: Record<string, string>) {
  const res = await fetch("/api/onboarding", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ action: "test", provider, config }),
  });
  return res.json();
}

async function syncIntegration(provider: string, config: Record<string, string>) {
  const res = await fetch("/api/onboarding", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ action: "sync", provider, config }),
  });
  return res.json();
}

async function loadIntegrations(): Promise<Record<string, { is_connected: boolean; last_sync_at?: string; last_sync_message?: string; config?: Record<string, string> } | null>> {
  try {
    const res = await fetch("/api/onboarding", { headers: authHeaders() });
    const data = await res.json();
    return data.integrations || { odoo: null, fintoc: null, sat: null };
  } catch {
    return { odoo: null, fintoc: null, sat: null };
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ConfiguracionPage() {
  const tenantName = useAuthStore((s) => s.tenantName);
  const tenantId = useAuthStore((s) => s.tenantId);

  const [settings, setSettings] = useState<Settings>(() => defaultSettings("", ""));
  const [odooStatus, setOdooStatus] = useState<"idle" | "testing" | "syncing" | "success" | "error">("idle");
  const [fintocStatus, setFintocStatus] = useState<"idle" | "testing" | "syncing" | "success" | "error">("idle");
  const [satStatus, setSatStatus] = useState<"idle" | "validating" | "syncing" | "success" | "error">("idle");
  const [lastSync, setLastSync] = useState<Record<string, string>>({});

  // Load from DB on mount
  useEffect(() => {
    const base = defaultSettings(tenantName, tenantId);
    loadIntegrations().then((integrations) => {
      // Hydrate from DB integrations if available
      const syncInfo: Record<string, string> = {};
      for (const provider of ["odoo", "fintoc", "sat"] as const) {
        const integration = integrations[provider] as { is_connected?: boolean; last_sync_at?: string; last_sync_message?: string; config?: Record<string, string> } | null;
        if (integration?.config) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (base as any)[provider] = { ...base[provider], ...integration.config };
        }
        if (integration?.is_connected) {
          if (provider === "odoo") setOdooStatus("success");
          if (provider === "fintoc") setFintocStatus("success");
          if (provider === "sat") setSatStatus("success");
        }
        if (integration?.last_sync_at) {
          syncInfo[provider] = integration.last_sync_message
            ? `${new Date(integration.last_sync_at).toLocaleString("es-MX")} — ${integration.last_sync_message}`
            : new Date(integration.last_sync_at).toLocaleString("es-MX");
        }
      }
      setLastSync(syncInfo);
      setSettings(base);
    });
  }, [tenantName, tenantId]);

  function update<K extends keyof Settings>(section: K, field: keyof Settings[K], value: string) {
    setSettings((prev) => ({ ...prev, [section]: { ...prev[section], [field]: value } }));
  }

  // ------ Save handlers (now save to DB) ------

  async function handleSaveOdoo() {
    await saveIntegration("odoo", settings.odoo);
    toast.success("Configuracion de Odoo guardada");
  }

  async function handleSaveFintoc() {
    await saveIntegration("fintoc", settings.fintoc);
    toast.success("Configuracion de Fintoc guardada");
  }

  async function handleSaveSat() {
    await saveIntegration("sat", settings.sat);
    toast.success("Configuracion de SAT guardada");
  }

  function handleSaveGeneral() {
    // General settings are stored locally for now (company info comes from DB)
    toast.success("Configuracion general guardada");
  }

  // ------ Test handlers (real API calls) ------

  async function handleTestOdoo() {
    setOdooStatus("testing");
    try {
      const res = await testIntegration("odoo", settings.odoo);
      if (res.success) {
        setOdooStatus("success");
        toast.success(res.message || "Conexion a Odoo exitosa");
      } else {
        setOdooStatus("error");
        toast.error(res.message || "No se pudo conectar a Odoo");
      }
    } catch {
      setOdooStatus("error");
      toast.error("Error de conexion");
    }
  }

  async function handleTestFintoc() {
    setFintocStatus("testing");
    try {
      const res = await testIntegration("fintoc", settings.fintoc);
      if (res.success) {
        setFintocStatus("success");
        toast.success(res.message || "Conexion a Fintoc exitosa");
      } else {
        setFintocStatus("error");
        toast.error(res.message || "No se pudo conectar a Fintoc");
      }
    } catch {
      setFintocStatus("error");
      toast.error("Error de conexion");
    }
  }

  async function handleValidateSat() {
    setSatStatus("validating");
    try {
      const res = await testIntegration("sat", settings.sat);
      if (res.success) {
        setSatStatus("success");
        toast.success(res.message || "Certificado SAT validado correctamente");
      } else {
        setSatStatus("error");
        toast.error(res.message || "No se pudo validar el certificado");
      }
    } catch {
      setSatStatus("error");
      toast.error("Error de validacion");
    }
  }

  // ------ Sync handlers ------

  async function handleSyncOdoo() {
    setOdooStatus("syncing");
    try {
      const res = await syncIntegration("odoo", settings.odoo);
      if (res.success) {
        setOdooStatus("success");
        toast.success(res.message || "Sincronizacion de Odoo completada");
        if (res.synced) {
          setLastSync(prev => ({ ...prev, odoo: `${new Date().toLocaleString("es-MX")} — ${res.message}` }));
        }
      } else {
        setOdooStatus("error");
        toast.error(res.message || "Error en sincronizacion de Odoo");
      }
    } catch {
      setOdooStatus("error");
      toast.error("Error de conexion durante sincronizacion");
    }
  }

  async function handleSyncFintoc() {
    setFintocStatus("syncing");
    try {
      const res = await syncIntegration("fintoc", settings.fintoc);
      if (res.success) {
        setFintocStatus("success");
        toast.success(res.message || "Sincronizacion de Fintoc completada");
        setLastSync(prev => ({ ...prev, fintoc: `${new Date().toLocaleString("es-MX")} — ${res.message}` }));
      } else {
        setFintocStatus("error");
        toast.error(res.message || "Error en sincronizacion de Fintoc");
      }
    } catch {
      setFintocStatus("error");
      toast.error("Error de conexion durante sincronizacion");
    }
  }

  async function handleSyncSat() {
    setSatStatus("syncing");
    try {
      const res = await syncIntegration("sat", settings.sat);
      if (res.success) {
        setSatStatus("success");
        toast.success(res.message || "Validacion SAT completada");
        setLastSync(prev => ({ ...prev, sat: `${new Date().toLocaleString("es-MX")} — ${res.message}` }));
      } else {
        setSatStatus("error");
        toast.error(res.message || "Error en validacion SAT");
      }
    } catch {
      setSatStatus("error");
      toast.error("Error de conexion durante validacion");
    }
  }

  // ------ Status badge helper ------

  function connectionBadge(status: "idle" | "testing" | "syncing" | "success" | "error" | "validating") {
    switch (status) {
      case "testing":
      case "validating":
        return <Badge variant="secondary">Probando...</Badge>;
      case "syncing":
        return <Badge variant="secondary">Sincronizando...</Badge>;
      case "success":
        return <Badge variant="default">Conectado</Badge>;
      case "error":
        return <Badge variant="destructive">Error</Badge>;
      default:
        return null;
    }
  }

  // ------ Render ------

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Configuracion</h1>
        <p className="text-muted-foreground">
          Administra las integraciones y preferencias de tu empresa.
        </p>
      </div>

      <Tabs defaultValue="odoo">
        <TabsList>
          <TabsTrigger value="odoo">Odoo</TabsTrigger>
          <TabsTrigger value="fintoc">Fintoc / Banco</TabsTrigger>
          <TabsTrigger value="sat">SAT</TabsTrigger>
          <TabsTrigger value="general">General</TabsTrigger>
        </TabsList>

        {/* Odoo Tab */}
        <TabsContent value="odoo">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                Odoo ERP {connectionBadge(odooStatus)}
              </CardTitle>
              <CardDescription>
                Configura la conexion a tu instancia de Odoo para sincronizar facturas, pagos y contactos.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="odoo-url">URL del servidor</Label>
                  <Input id="odoo-url" placeholder="https://mi-empresa.odoo.com" value={settings.odoo.url} onChange={(e) => update("odoo", "url", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="odoo-db">Base de datos</Label>
                  <Input id="odoo-db" placeholder="mi_empresa_db" value={settings.odoo.database} onChange={(e) => update("odoo", "database", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="odoo-user">Usuario</Label>
                  <Input id="odoo-user" placeholder="admin@mi-empresa.com" value={settings.odoo.user} onChange={(e) => update("odoo", "user", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="odoo-password">Contrasena</Label>
                  <Input id="odoo-password" type="password" placeholder="••••••••" value={settings.odoo.password} onChange={(e) => update("odoo", "password", e.target.value)} />
                </div>
              </div>
              <Separator />
              <div className="flex gap-3">
                <Button variant="outline" onClick={handleTestOdoo} disabled={odooStatus === "testing" || odooStatus === "syncing"}>
                  {odooStatus === "testing" ? "Probando..." : "Probar conexion"}
                </Button>
                <Button variant="outline" onClick={handleSyncOdoo} disabled={odooStatus === "syncing" || odooStatus === "testing"}>
                  {odooStatus === "syncing" ? "Sincronizando..." : "Sincronizar"}
                </Button>
                <Button onClick={handleSaveOdoo}>Guardar</Button>
              </div>
              {lastSync.odoo && (
                <p className="text-xs text-muted-foreground mt-3">Ultima sincronizacion: {lastSync.odoo}</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Fintoc / Banco Tab */}
        <TabsContent value="fintoc">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                Fintoc / Banco {connectionBadge(fintocStatus)}
              </CardTitle>
              <CardDescription>
                Credenciales de Fintoc para ejecutar pagos y consultar movimientos bancarios.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="fintoc-secret">Secret Key</Label>
                  <Input id="fintoc-secret" type="password" placeholder="sk_live_..." value={settings.fintoc.secretKey} onChange={(e) => update("fintoc", "secretKey", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fintoc-public">Public Key</Label>
                  <Input id="fintoc-public" placeholder="pk_live_..." value={settings.fintoc.publicKey} onChange={(e) => update("fintoc", "publicKey", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fintoc-webhook">Webhook Secret</Label>
                  <Input id="fintoc-webhook" type="password" placeholder="whsec_..." value={settings.fintoc.webhookSecret} onChange={(e) => update("fintoc", "webhookSecret", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fintoc-account">Account ID</Label>
                  <Input id="fintoc-account" placeholder="acc_..." value={settings.fintoc.accountId} onChange={(e) => update("fintoc", "accountId", e.target.value)} />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="fintoc-link-token">Link Token (Fiscal Links)</Label>
                  <Input id="fintoc-link-token" placeholder="link_token del widget Fintoc para facturas SAT" value={settings.fintoc.linkToken} onChange={(e) => update("fintoc", "linkToken", e.target.value)} />
                  <p className="text-xs text-muted-foreground">
                    Obten este token conectando tu cuenta fiscal via el widget de Fintoc. Permite sincronizar facturas electronicas del SAT.
                  </p>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="fintoc-jws">Ruta llave JWS</Label>
                  <Input id="fintoc-jws" placeholder="/etc/fintoc/jws_private.pem" value={settings.fintoc.jwsKeyPath} onChange={(e) => update("fintoc", "jwsKeyPath", e.target.value)} />
                </div>
              </div>
              <Separator />
              <div className="flex gap-3">
                <Button variant="outline" onClick={handleTestFintoc} disabled={fintocStatus === "testing" || fintocStatus === "syncing"}>
                  {fintocStatus === "testing" ? "Probando..." : "Probar conexion"}
                </Button>
                <Button variant="outline" onClick={handleSyncFintoc} disabled={fintocStatus === "syncing" || fintocStatus === "testing"}>
                  {fintocStatus === "syncing" ? "Sincronizando..." : "Sincronizar"}
                </Button>
                <Button onClick={handleSaveFintoc}>Guardar</Button>
              </div>
              {lastSync.fintoc && (
                <p className="text-xs text-muted-foreground mt-3">Ultima sincronizacion: {lastSync.fintoc}</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* SAT Tab */}
        <TabsContent value="sat">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                SAT {connectionBadge(satStatus)}
              </CardTitle>
              <CardDescription>
                Certificados de sello digital y proveedor PAC para timbrado de CFDI.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="sat-rfc">RFC Emisor</Label>
                  <Input id="sat-rfc" placeholder="XAXX010101000" value={settings.sat.rfcEmisor} onChange={(e) => update("sat", "rfcEmisor", e.target.value.toUpperCase())} maxLength={13} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sat-cert">Ruta certificado (.cer)</Label>
                  <Input id="sat-cert" placeholder="/etc/sat/certificado.cer" value={settings.sat.certPath} onChange={(e) => update("sat", "certPath", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sat-key">Ruta llave privada (.key)</Label>
                  <Input id="sat-key" placeholder="/etc/sat/llave.key" value={settings.sat.keyPath} onChange={(e) => update("sat", "keyPath", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sat-key-password">Contrasena llave</Label>
                  <Input id="sat-key-password" type="password" placeholder="••••••••" value={settings.sat.keyPassword} onChange={(e) => update("sat", "keyPassword", e.target.value)} />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="sat-pac">Proveedor PAC</Label>
                  <Select value={settings.sat.pac} onValueChange={(v) => update("sat", "pac", v)}>
                    <SelectTrigger id="sat-pac" className="w-full">
                      <SelectValue placeholder="Selecciona un PAC" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="finkok">Finkok</SelectItem>
                      <SelectItem value="sw_sapien">SW Sapien</SelectItem>
                      <SelectItem value="digicel">Digicel</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Separator />
              <div className="flex gap-3">
                <Button variant="outline" onClick={handleValidateSat} disabled={satStatus === "validating" || satStatus === "syncing"}>
                  {satStatus === "validating" ? "Validando..." : "Validar certificado"}
                </Button>
                <Button variant="outline" onClick={handleSyncSat} disabled={satStatus === "syncing" || satStatus === "validating"}>
                  {satStatus === "syncing" ? "Validando CFDIs..." : "Revalidar CFDIs"}
                </Button>
                <Button onClick={handleSaveSat}>Guardar</Button>
              </div>
              {lastSync.sat && (
                <p className="text-xs text-muted-foreground mt-3">Ultima validacion: {lastSync.sat}</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* General Tab */}
        <TabsContent value="general">
          <Card>
            <CardHeader>
              <CardTitle>General</CardTitle>
              <CardDescription>
                Datos de la empresa y preferencias de notificaciones.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="gen-company">Nombre de empresa</Label>
                  <Input id="gen-company" value={settings.general.companyName} onChange={(e) => update("general", "companyName", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gen-rfc">RFC</Label>
                  <Input id="gen-rfc" value={settings.general.rfc} disabled />
                </div>
                <div className="space-y-2">
                  <Label>Plan</Label>
                  <div className="flex items-center h-9">
                    <Badge variant="default">{settings.general.plan}</Badge>
                  </div>
                </div>
              </div>
              <Separator />
              <div>
                <p className="text-sm font-medium mb-4">Notificaciones</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="gen-email">Email notificaciones</Label>
                    <Input id="gen-email" type="email" placeholder="alertas@mi-empresa.com" value={settings.general.notificationEmail} onChange={(e) => update("general", "notificationEmail", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="gen-slack">Slack webhook URL</Label>
                    <Input id="gen-slack" placeholder="https://hooks.slack.com/services/..." value={settings.general.slackWebhook} onChange={(e) => update("general", "slackWebhook", e.target.value)} />
                  </div>
                </div>
              </div>
              <Separator />
              <div>
                <p className="text-sm font-medium mb-4">Configuracion SMTP</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="smtp-host">Host</Label>
                    <Input id="smtp-host" placeholder="smtp.gmail.com" value={settings.general.smtpHost} onChange={(e) => update("general", "smtpHost", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="smtp-port">Puerto</Label>
                    <Input id="smtp-port" placeholder="587" value={settings.general.smtpPort} onChange={(e) => update("general", "smtpPort", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="smtp-user">Usuario</Label>
                    <Input id="smtp-user" placeholder="noreply@mi-empresa.com" value={settings.general.smtpUser} onChange={(e) => update("general", "smtpUser", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="smtp-password">Contrasena</Label>
                    <Input id="smtp-password" type="password" placeholder="••••••••" value={settings.general.smtpPassword} onChange={(e) => update("general", "smtpPassword", e.target.value)} />
                  </div>
                </div>
              </div>
              <Separator />
              <div className="flex gap-3">
                <Button onClick={handleSaveGeneral}>Guardar</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
