"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAuthStore } from "@/lib/store";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

// ── Types ──

interface StepConfig {
  odoo: { url: string; database: string; user: string; password: string };
  fintoc: { secretKey: string; publicKey: string; webhookSecret: string; linkToken: string; accountId: string };
  sat: { rfcEmisor: string };
}

interface IntegrationStatus {
  is_connected: boolean;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_message: string | null;
}

// ── API helper ──

function authHeaders() {
  const token = localStorage.getItem("token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function onboardingApi(method: "GET" | "POST", body?: unknown) {
  const res = await fetch("/api/onboarding", {
    method,
    headers: authHeaders(),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
}

// ── Steps ──

const STEPS = [
  { key: "odoo" as const, title: "Odoo ERP", desc: "Conecta tu ERP para sincronizar clientes, proveedores y facturas." },
  { key: "fintoc" as const, title: "Fintoc / Banco", desc: "Configura pagos SPEI y consulta de movimientos bancarios." },
  { key: "sat" as const, title: "SAT", desc: "Configura tu RFC para validacion de CFDI." },
];

export default function OnboardingPage() {
  const router = useRouter();
  const tenantName = useAuthStore((s) => s.tenantName);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState<"test" | "sync" | "save" | null>(null);
  const [statuses, setStatuses] = useState<Record<string, IntegrationStatus | null>>({
    odoo: null, fintoc: null, sat: null,
  });

  const [config, setConfig] = useState<StepConfig>({
    odoo: { url: "", database: "", user: "", password: "" },
    fintoc: { secretKey: "", publicKey: "", webhookSecret: "", linkToken: "", accountId: "" },
    sat: { rfcEmisor: "" },
  });

  // Load existing status on mount
  useEffect(() => {
    onboardingApi("GET").then((data) => {
      if (data.integrations) setStatuses(data.integrations);
      if (data.onboarding_completed) {
        // Already completed, but let them revisit
      }
    }).catch(() => {});
  }, []);

  const currentStep = STEPS[step];

  function updateField(provider: keyof StepConfig, field: string, value: string) {
    setConfig((prev) => ({
      ...prev,
      [provider]: { ...prev[provider], [field]: value },
    }));
  }

  async function handleTest() {
    setLoading("test");
    try {
      const res = await onboardingApi("POST", {
        action: "test",
        provider: currentStep.key,
        config: config[currentStep.key],
      });
      if (res.success) {
        toast.success(res.message || "Conexion exitosa");
        setStatuses((prev) => ({
          ...prev,
          [currentStep.key]: { is_connected: true, last_sync_status: "connected", last_sync_at: null, last_sync_message: res.message },
        }));
      } else {
        toast.error(res.message || "Error de conexion");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error de conexion");
    }
    setLoading(null);
  }

  async function handleSaveAndContinue() {
    setLoading("save");
    try {
      // Save config
      await onboardingApi("POST", {
        action: "save",
        provider: currentStep.key,
        config: config[currentStep.key],
      });

      if (step < STEPS.length - 1) {
        setStep(step + 1);
        toast.success(`${currentStep.title} guardado`);
      } else {
        // Complete onboarding
        await onboardingApi("POST", { action: "complete" });
        toast.success("Onboarding completado");
        router.push("/");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    }
    setLoading(null);
  }

  async function handleSync() {
    setLoading("sync");
    try {
      const res = await onboardingApi("POST", {
        action: "sync",
        provider: currentStep.key,
        config: config[currentStep.key],
      });
      if (res.success) {
        toast.success(res.message || "Sincronizacion exitosa");
        if (res.synced) {
          const parts = [];
          if (res.synced.customers) parts.push(`${res.synced.customers} clientes`);
          if (res.synced.vendors) parts.push(`${res.synced.vendors} proveedores`);
          if (res.synced.invoices) parts.push(`${res.synced.invoices} facturas`);
          if (parts.length > 0) toast.info(`Importados: ${parts.join(", ")}`);
        }
        setStatuses((prev) => ({
          ...prev,
          [currentStep.key]: {
            is_connected: true,
            last_sync_at: new Date().toISOString(),
            last_sync_status: "success",
            last_sync_message: res.message,
          },
        }));
      } else {
        toast.error(res.message || "Error en sincronizacion");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error en sincronizacion");
    }
    setLoading(null);
  }

  function handleSkip() {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    } else {
      onboardingApi("POST", { action: "complete" }).then(() => {
        router.push("/");
      });
    }
  }

  const status = statuses[currentStep.key];
  const isConnected = status?.is_connected === true;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Configuracion inicial</h1>
        <p className="text-muted-foreground">
          Conecta tus servicios para empezar a usar {tenantName || "Payana"}.
        </p>
      </div>

      {/* Progress */}
      <div className="flex gap-2">
        {STEPS.map((s, i) => (
          <button
            key={s.key}
            onClick={() => setStep(i)}
            className={`flex-1 h-2 rounded-full transition-colors ${
              i <= step ? "bg-primary" : "bg-muted"
            }`}
          />
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        Paso {step + 1} de {STEPS.length}: {currentStep.title}
      </p>

      {/* Step Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            {currentStep.title}
            {isConnected && <Badge variant="default">Conectado</Badge>}
            {status?.last_sync_status === "error" && <Badge variant="destructive">Error</Badge>}
          </CardTitle>
          <CardDescription>{currentStep.desc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Odoo fields */}
          {currentStep.key === "odoo" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>URL del servidor</Label>
                <Input
                  placeholder="https://mi-empresa.odoo.com"
                  value={config.odoo.url}
                  onChange={(e) => updateField("odoo", "url", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Base de datos</Label>
                <Input
                  placeholder="mi_empresa_db"
                  value={config.odoo.database}
                  onChange={(e) => updateField("odoo", "database", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Usuario</Label>
                <Input
                  placeholder="admin@mi-empresa.com"
                  value={config.odoo.user}
                  onChange={(e) => updateField("odoo", "user", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Contrasena</Label>
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={config.odoo.password}
                  onChange={(e) => updateField("odoo", "password", e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Fintoc fields */}
          {currentStep.key === "fintoc" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Secret Key</Label>
                <Input
                  type="password"
                  placeholder="sk_live_..."
                  value={config.fintoc.secretKey}
                  onChange={(e) => updateField("fintoc", "secretKey", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Public Key</Label>
                <Input
                  placeholder="pk_live_..."
                  value={config.fintoc.publicKey}
                  onChange={(e) => updateField("fintoc", "publicKey", e.target.value)}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Webhook Secret</Label>
                <Input
                  type="password"
                  placeholder="whsec_..."
                  value={config.fintoc.webhookSecret}
                  onChange={(e) => updateField("fintoc", "webhookSecret", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Link Token (Fiscal)</Label>
                <Input
                  placeholder="link_token del widget Fintoc"
                  value={config.fintoc.linkToken}
                  onChange={(e) => updateField("fintoc", "linkToken", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Token para sincronizar facturas del SAT via Fintoc Fiscal Links.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Account ID</Label>
                <Input
                  placeholder="acc_..."
                  value={config.fintoc.accountId}
                  onChange={(e) => updateField("fintoc", "accountId", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  ID de la cuenta bancaria principal para movimientos.
                </p>
              </div>
            </div>
          )}

          {/* SAT fields */}
          {currentStep.key === "sat" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>RFC Emisor</Label>
                <Input
                  placeholder="XAXX010101000"
                  value={config.sat.rfcEmisor}
                  onChange={(e) => updateField("sat", "rfcEmisor", e.target.value.toUpperCase())}
                  maxLength={13}
                />
              </div>
            </div>
          )}

          {/* Last sync info */}
          {status?.last_sync_message && (
            <>
              <Separator />
              <p className="text-sm text-muted-foreground">
                {status.last_sync_message}
                {status.last_sync_at && (
                  <> — {new Date(status.last_sync_at).toLocaleString("es-MX")}</>
                )}
              </p>
            </>
          )}

          <Separator />

          {/* Actions */}
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={loading !== null}
            >
              {loading === "test" ? "Probando..." : "Probar conexion"}
            </Button>

            {currentStep.key === "odoo" && isConnected && (
              <Button
                variant="outline"
                onClick={handleSync}
                disabled={loading !== null}
              >
                {loading === "sync" ? "Sincronizando..." : "Sincronizar datos"}
              </Button>
            )}

            {currentStep.key === "fintoc" && isConnected && (
              <Button
                variant="outline"
                onClick={handleSync}
                disabled={loading !== null}
              >
                {loading === "sync" ? "Sincronizando..." : "Sincronizar cuentas"}
              </Button>
            )}

            <div className="flex-1" />

            <Button variant="ghost" onClick={handleSkip}>
              Omitir
            </Button>
            <Button
              onClick={handleSaveAndContinue}
              disabled={loading !== null}
            >
              {loading === "save"
                ? "Guardando..."
                : step < STEPS.length - 1
                ? "Guardar y continuar"
                : "Finalizar"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary of all steps */}
      <div className="grid gap-3 sm:grid-cols-3">
        {STEPS.map((s, i) => {
          const st = statuses[s.key];
          return (
            <button
              key={s.key}
              onClick={() => setStep(i)}
              className={`text-left p-3 rounded-lg border transition-colors ${
                i === step ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <div className="flex items-center gap-2">
                <div
                  className={`w-6 h-6 rounded-full text-xs flex items-center justify-center font-medium ${
                    st?.is_connected
                      ? "bg-green-100 text-green-700"
                      : i === step
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {st?.is_connected ? "\u2713" : i + 1}
                </div>
                <span className="text-sm font-medium">{s.title}</span>
              </div>
              {st?.is_connected && (
                <p className="text-xs text-muted-foreground mt-1 ml-8">Conectado</p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
