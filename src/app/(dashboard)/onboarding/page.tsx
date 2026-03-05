"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2,
  Loader2,
  ArrowRight,
  ArrowLeft,
  Landmark,
  ShieldCheck,
  Server,
  Rocket,
  SkipForward,
} from "lucide-react";

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

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/store";

/* ---------- Step definitions ---------- */

const STEPS = [
  {
    key: "welcome" as const,
    title: "Bienvenida",
    description: "Configura tu plataforma paso a paso.",
    icon: Rocket,
    optional: false,
  },
  {
    key: "odoo" as const,
    title: "Odoo (ERP)",
    description: "Conecta tu ERP para sincronizar clientes, proveedores y facturas.",
    icon: Server,
    optional: true,
  },
  {
    key: "fintoc" as const,
    title: "Fintoc (Pagos)",
    description: "Configura pagos SPEI y consulta de movimientos bancarios.",
    icon: Landmark,
    optional: true,
  },
  {
    key: "sat" as const,
    title: "SAT (Fiscal)",
    description: "Conecta con el SAT via Syntage para descargar CFDIs y declaraciones.",
    icon: ShieldCheck,
    optional: true,
  },
];

type StepKey = (typeof STEPS)[number]["key"];

/* ---------- Zod schemas per step ---------- */

const odooSchema = z.object({
  url: z.string().url("Ingresa una URL valida").min(1, "URL requerida"),
  database: z.string().min(1, "Base de datos requerida"),
  user: z.string().min(1, "Usuario requerido"),
  apiKey: z.string().min(1, "API Key requerida"),
});

const fintocSchema = z.object({
  secretKey: z.string().min(1, "Secret Key requerida"),
});

const satSchema = z.object({
  syntageApiKey: z.string().min(1, "API Key de Syntage requerida"),
  rfcEmisor: z
    .string()
    .min(12, "RFC debe tener entre 12 y 13 caracteres")
    .max(13, "RFC debe tener entre 12 y 13 caracteres"),
  fielPassword: z.string().min(1, "Contrasena de FIEL requerida"),
});

type OdooForm = z.infer<typeof odooSchema>;
type FintocForm = z.infer<typeof fintocSchema>;
type SatForm = z.infer<typeof satSchema>;

/* ---------- Connection result ---------- */

interface TestResult {
  success: boolean;
  message?: string;
  bank?: string;
  clabe?: string;
  rfc?: string;
  vigencia?: string;
}

/* ---------- Horizontal Stepper ---------- */

function Stepper({
  steps,
  currentStep,
  completedSteps,
  onStepClick,
}: {
  steps: typeof STEPS;
  currentStep: number;
  completedSteps: Set<string>;
  onStepClick: (index: number) => void;
}) {
  return (
    <div className="flex items-center gap-0 w-full">
      {steps.map((step, i) => {
        const isCompleted = completedSteps.has(step.key);
        const isCurrent = i === currentStep;

        return (
          <div key={step.key} className="flex items-center flex-1">
            <button
              onClick={() => onStepClick(i)}
              className="flex flex-col items-center flex-1 group"
            >
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium border-2 transition-colors ${
                  isCompleted
                    ? "border-green-600 bg-green-600 text-white"
                    : isCurrent
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/30 bg-background text-muted-foreground group-hover:border-muted-foreground/50"
                }`}
              >
                {isCompleted ? (
                  <CheckCircle2 className="size-5" />
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={`mt-2 text-xs text-center ${
                  isCurrent ? "font-semibold text-foreground" : "text-muted-foreground"
                }`}
              >
                {step.title}
              </span>
            </button>
            {i < steps.length - 1 && (
              <div
                className={`h-0.5 w-full mx-2 ${
                  completedSteps.has(step.key)
                    ? "bg-green-600"
                    : "bg-muted-foreground/20"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Main Page ---------- */

export default function OnboardingPage() {
  const router = useRouter();
  const activeCompany = useAuthStore((s) => s.activeCompany);
  const [step, setStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set(["welcome"]));
  const [testResults, setTestResults] = useState<Record<string, TestResult | null>>({
    odoo: null,
    fintoc: null,
    sat: null,
  });
  const [configsLoaded, setConfigsLoaded] = useState(false);

  // SAT file refs
  const cerInputRef = useRef<HTMLInputElement>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);
  const [cerFile, setCerFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);

  const currentStep = STEPS[step];

  /* ----- Forms ----- */

  const odooForm = useForm<OdooForm>({
    resolver: zodResolver(odooSchema),
    defaultValues: { url: "", database: "", user: "", apiKey: "" },
  });

  const fintocForm = useForm<FintocForm>({
    resolver: zodResolver(fintocSchema),
    defaultValues: { secretKey: "" },
  });

  const satForm = useForm<SatForm>({
    resolver: zodResolver(satSchema),
    defaultValues: { syntageApiKey: "", rfcEmisor: "", fielPassword: "" },
  });

  /* ----- Load existing configs ----- */

  const { data: existingStatus } = useQuery({
    queryKey: ["onboarding", "status"],
    queryFn: () => api.onboarding.status(),
    staleTime: 0,
  });

  useEffect(() => {
    if (!existingStatus || configsLoaded) return;
    setConfigsLoaded(true);

    const completed = new Set<string>(["welcome"]);

    // Load Odoo config
    if (existingStatus.odoo?.config) {
      const c = existingStatus.odoo.config;
      odooForm.reset({
        url: c.url || "",
        database: c.database || "",
        user: c.user || "",
        apiKey: c.password || "",
      });
      if (existingStatus.odoo.is_connected) {
        completed.add("odoo");
        setTestResults((prev) => ({ ...prev, odoo: { success: true, message: "Conectado previamente" } }));
      }
    }

    // Load Fintoc config
    if (existingStatus.fintoc?.config) {
      const c = existingStatus.fintoc.config;
      fintocForm.reset({ secretKey: c.secretKey || "" });
      if (existingStatus.fintoc.is_connected) {
        completed.add("fintoc");
        setTestResults((prev) => ({ ...prev, fintoc: { success: true, message: "Conectado previamente" } }));
      }
    }

    // Load SAT config
    if (existingStatus.sat?.config) {
      const c = existingStatus.sat.config;
      satForm.reset({
        syntageApiKey: c.syntageApiKey || "",
        rfcEmisor: c.rfcEmisor || activeCompany?.rfc || "",
        fielPassword: c.fielPassword || "",
      });
      if (existingStatus.sat.is_connected) {
        completed.add("sat");
        setTestResults((prev) => ({ ...prev, sat: { success: true, message: "Conectado previamente" } }));
      }
    }

    // Pre-fill RFC from company
    if (!existingStatus.sat?.config?.rfcEmisor && activeCompany?.rfc) {
      satForm.setValue("rfcEmisor", activeCompany.rfc);
    }

    setCompletedSteps(completed);
  }, [existingStatus, configsLoaded, odooForm, fintocForm, satForm, activeCompany]);

  /* ----- Test Connection Mutation ----- */

  const testConnection = useMutation({
    mutationFn: (params: { provider: string; config: Record<string, string> }) =>
      api.onboarding.test(params.provider, params.config),
    onSuccess: (data, variables) => {
      const result: TestResult = {
        success: data.success,
        message: data.message,
        bank: data.bank,
        clabe: data.clabe,
        rfc: data.rfc,
        vigencia: data.vigencia,
      };
      setTestResults((prev) => ({ ...prev, [variables.provider]: result }));

      if (data.success) {
        toast.success(data.message || "Conexion exitosa");
        setCompletedSteps((prev) => new Set([...prev, variables.provider]));
      } else {
        toast.error(data.message || "Error de conexion");
      }
    },
    onError: (err: Error) => {
      toast.error(err.message || "Error de conexion");
    },
  });

  /* ----- Save step mutation ----- */

  const saveMutation = useMutation({
    mutationFn: (params: { provider: string; config: Record<string, string> }) =>
      api.onboarding.save(params.provider, params.config),
  });

  const completeMutation = useMutation({
    mutationFn: () => api.onboarding.complete(),
    onSuccess: () => {
      toast.success("Configuracion completada. Bienvenido!");
      router.push("/");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Error al completar onboarding");
    },
  });

  /* ----- Handlers ----- */

  function getConfigForStep(stepKey: StepKey): { provider: string; config: Record<string, string> } | null {
    if (stepKey === "odoo") {
      const values = odooForm.getValues();
      if (!values.url && !values.database && !values.user && !values.apiKey) return null;
      return {
        provider: "odoo",
        config: { url: values.url, database: values.database, user: values.user, password: values.apiKey },
      };
    }
    if (stepKey === "fintoc") {
      const values = fintocForm.getValues();
      if (!values.secretKey) return null;
      return { provider: "fintoc", config: { secretKey: values.secretKey } };
    }
    if (stepKey === "sat") {
      const values = satForm.getValues();
      if (!values.syntageApiKey && !values.rfcEmisor) return null;
      return {
        provider: "sat",
        config: { syntageApiKey: values.syntageApiKey, rfcEmisor: values.rfcEmisor, fielPassword: values.fielPassword },
      };
    }
    return null;
  }

  async function handleTestOdoo() {
    const valid = await odooForm.trigger();
    if (!valid) return;
    const values = odooForm.getValues();
    testConnection.mutate({
      provider: "odoo",
      config: { url: values.url, database: values.database, user: values.user, password: values.apiKey },
    });
  }

  async function handleTestFintoc() {
    const valid = await fintocForm.trigger();
    if (!valid) return;
    const values = fintocForm.getValues();
    testConnection.mutate({
      provider: "fintoc",
      config: { secretKey: values.secretKey },
    });
  }

  async function handleTestSat() {
    const valid = await satForm.trigger();
    if (!valid) return;
    const values = satForm.getValues();

    try {
      await api.sat.syntage.saveConfig({ syntageApiKey: values.syntageApiKey });
    } catch { /* will fail on test if key is bad */ }

    testConnection.mutate({
      provider: "sat",
      config: { syntageApiKey: values.syntageApiKey, rfcEmisor: values.rfcEmisor, fielPassword: values.fielPassword },
    });
  }

  async function handleNext() {
    // Save current step config before advancing
    const config = getConfigForStep(currentStep.key);
    if (config) {
      try {
        await saveMutation.mutateAsync(config);
      } catch {
        // Continue anyway - user can retry later
      }
    }

    if (step < STEPS.length - 1) {
      setStep(step + 1);
    }
  }

  function handleBack() {
    if (step > 0) {
      setStep(step - 1);
    }
  }

  function handleSkip() {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    }
  }

  async function handleComplete() {
    // Save last step if it has data
    const config = getConfigForStep(currentStep.key);
    if (config) {
      try {
        await saveMutation.mutateAsync(config);
      } catch { /* continue */ }
    }
    completeMutation.mutate();
  }

  const isLastStep = step === STEPS.length - 1;
  const testResult = testResults[currentStep.key];
  const isConnected = testResult?.success === true;
  const isTesting = testConnection.isPending;
  const isSaving = saveMutation.isPending;
  const isCompleting = completeMutation.isPending;
  const isBusy = isTesting || isSaving || isCompleting;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Configuracion Inicial</h1>
        <p className="text-muted-foreground">
          {activeCompany?.name
            ? `Configura ${activeCompany.name} paso a paso.`
            : "Conecta tus servicios para empezar a usar la plataforma."}
        </p>
      </div>

      {/* Stepper */}
      <Stepper
        steps={STEPS}
        currentStep={step}
        completedSteps={completedSteps}
        onStepClick={setStep}
      />

      {/* Step Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <currentStep.icon className="size-5" />
            {currentStep.title}
            {isConnected && (
              <Badge className="bg-green-600 text-white">Conectado</Badge>
            )}
            {testResult && !testResult.success && (
              <Badge variant="destructive">Error</Badge>
            )}
            {currentStep.optional && !isConnected && (
              <Badge variant="outline" className="text-muted-foreground">Opcional</Badge>
            )}
          </CardTitle>
          <CardDescription>{currentStep.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Step 0: Welcome */}
          {currentStep.key === "welcome" && (
            <div className="space-y-6">
              <div className="rounded-lg border bg-muted/50 p-6 space-y-4">
                <h3 className="text-lg font-semibold">
                  Bienvenido a {activeCompany?.name || "la plataforma"}
                </h3>
                <p className="text-sm text-muted-foreground">
                  En los siguientes pasos puedes conectar tus integraciones. Cada paso es <strong>opcional</strong> y puedes configurarlos despues desde Configuracion.
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  {STEPS.filter((s) => s.key !== "welcome").map((s) => (
                    <div key={s.key} className="flex items-start gap-3 p-3 rounded-lg border bg-background">
                      <s.icon className="size-5 text-primary mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-medium">{s.title}</p>
                        <p className="text-xs text-muted-foreground">{s.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 1: Odoo */}
          {currentStep.key === "odoo" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="odoo-url">URL *</Label>
                <Input
                  id="odoo-url"
                  placeholder="https://mi-empresa.odoo.com"
                  {...odooForm.register("url")}
                />
                {odooForm.formState.errors.url && (
                  <p className="text-xs text-destructive">
                    {odooForm.formState.errors.url.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="odoo-db">Base de datos *</Label>
                <Input
                  id="odoo-db"
                  placeholder="mi_empresa_db"
                  {...odooForm.register("database")}
                />
                {odooForm.formState.errors.database && (
                  <p className="text-xs text-destructive">
                    {odooForm.formState.errors.database.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="odoo-user">Usuario *</Label>
                <Input
                  id="odoo-user"
                  placeholder="admin@mi-empresa.com"
                  {...odooForm.register("user")}
                />
                {odooForm.formState.errors.user && (
                  <p className="text-xs text-destructive">
                    {odooForm.formState.errors.user.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="odoo-api-key">API Key *</Label>
                <Input
                  id="odoo-api-key"
                  type="password"
                  placeholder="••••••••"
                  {...odooForm.register("apiKey")}
                />
                {odooForm.formState.errors.apiKey && (
                  <p className="text-xs text-destructive">
                    {odooForm.formState.errors.apiKey.message}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Step 2: Fintoc */}
          {currentStep.key === "fintoc" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fintoc-secret">Secret Key *</Label>
                <Input
                  id="fintoc-secret"
                  type="password"
                  placeholder="sk_live_..."
                  {...fintocForm.register("secretKey")}
                />
                {fintocForm.formState.errors.secretKey && (
                  <p className="text-xs text-destructive">
                    {fintocForm.formState.errors.secretKey.message}
                  </p>
                )}
              </div>
              {isConnected && testResult && (
                <div className="rounded-lg border p-4 space-y-2">
                  <p className="text-sm font-medium">Cuenta detectada:</p>
                  {testResult.bank && (
                    <div className="flex items-center gap-2 text-sm">
                      <Landmark className="size-4 text-muted-foreground" />
                      <span>Banco: {testResult.bank}</span>
                    </div>
                  )}
                  {testResult.clabe && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">CLABE:</span>
                      <span className="font-mono">{testResult.clabe}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 3: SAT via Syntage */}
          {currentStep.key === "sat" && (
            <div className="space-y-6">
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
                Se usa <strong>Syntage</strong> (api.syntage.com) como intermediario.
                Sube tu FIEL y Syntage se encarga de validarla contra el SAT.
              </div>

              <div className="space-y-2">
                <Label htmlFor="sat-syntage-key">API Key de Syntage *</Label>
                <Input
                  id="sat-syntage-key"
                  type="password"
                  placeholder="sk_live_..."
                  {...satForm.register("syntageApiKey")}
                />
                {satForm.formState.errors.syntageApiKey && (
                  <p className="text-xs text-destructive">
                    {satForm.formState.errors.syntageApiKey.message}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Obten tu API Key en{" "}
                  <a href="https://app.syntage.com" target="_blank" rel="noopener" className="underline">
                    app.syntage.com
                  </a>
                </p>
              </div>

              <Separator />

              <div className="space-y-2">
                <Label htmlFor="sat-rfc">RFC *</Label>
                <Input
                  id="sat-rfc"
                  placeholder="XAXX010101000"
                  maxLength={13}
                  {...satForm.register("rfcEmisor", {
                    onChange: (e) => {
                      e.target.value = e.target.value.toUpperCase();
                    },
                  })}
                />
                {satForm.formState.errors.rfcEmisor && (
                  <p className="text-xs text-destructive">
                    {satForm.formState.errors.rfcEmisor.message}
                  </p>
                )}
              </div>

              <div>
                <p className="text-sm font-medium mb-3">
                  e.FIRMA (FIEL)
                </p>
                <p className="text-xs text-muted-foreground mb-3">
                  Syntage usa tu FIEL para conectarse al SAT de forma segura. Los archivos se envian directamente a Syntage.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="sat-cer">Certificado (.cer)</Label>
                    <Input
                      ref={cerInputRef}
                      id="sat-cer"
                      type="file"
                      accept=".cer"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file && file.name.toLowerCase().endsWith(".cer")) {
                          setCerFile(file);
                        } else if (file) {
                          toast.error("Solo se aceptan archivos .cer");
                          e.target.value = "";
                        }
                      }}
                    />
                    {cerFile && (
                      <p className="text-xs text-blue-600">
                        {cerFile.name} ({(cerFile.size / 1024).toFixed(1)} KB)
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sat-key">Llave Privada (.key)</Label>
                    <Input
                      ref={keyInputRef}
                      id="sat-key"
                      type="file"
                      accept=".key"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file && file.name.toLowerCase().endsWith(".key")) {
                          setKeyFile(file);
                        } else if (file) {
                          toast.error("Solo se aceptan archivos .key");
                          e.target.value = "";
                        }
                      }}
                    />
                    {keyFile && (
                      <p className="text-xs text-blue-600">
                        {keyFile.name} ({(keyFile.size / 1024).toFixed(1)} KB)
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="sat-password">Contrasena de FIEL *</Label>
                <Input
                  id="sat-password"
                  type="password"
                  placeholder="••••••••"
                  {...satForm.register("fielPassword")}
                />
                {satForm.formState.errors.fielPassword && (
                  <p className="text-xs text-destructive">
                    {satForm.formState.errors.fielPassword.message}
                  </p>
                )}
              </div>

              {isConnected && testResult && (
                <div className="rounded-lg border border-green-200 bg-green-50 p-4 space-y-2 dark:border-green-900 dark:bg-green-950">
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">Syntage conectado</p>
                  {testResult.rfc && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">RFC:</span>
                      <span className="font-mono">{testResult.rfc}</span>
                    </div>
                  )}
                  {testResult.message && (
                    <p className="text-xs text-green-700 dark:text-green-300">{testResult.message}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Test result message (non-welcome steps) */}
          {currentStep.key !== "welcome" && testResult?.message && (
            <>
              <Separator />
              <p
                className={`text-sm ${
                  testResult.success ? "text-green-600" : "text-destructive"
                }`}
              >
                {testResult.message}
              </p>
            </>
          )}

          <Separator />

          {/* Actions */}
          <div className="flex items-center justify-between">
            <div className="flex gap-3">
              {currentStep.key !== "welcome" && (
                <Button
                  variant="outline"
                  onClick={
                    currentStep.key === "odoo"
                      ? handleTestOdoo
                      : currentStep.key === "fintoc"
                      ? handleTestFintoc
                      : handleTestSat
                  }
                  disabled={isBusy}
                >
                  {isTesting ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : null}
                  Probar Conexion
                </Button>
              )}
            </div>

            <div className="flex gap-3">
              {step > 0 && (
                <Button variant="ghost" onClick={handleBack} disabled={isBusy}>
                  <ArrowLeft className="mr-2 size-4" />
                  Anterior
                </Button>
              )}
              {currentStep.optional && !isConnected && !isLastStep && (
                <Button variant="ghost" onClick={handleSkip} disabled={isBusy}>
                  <SkipForward className="mr-2 size-4" />
                  Saltar
                </Button>
              )}
              {isLastStep ? (
                <Button onClick={handleComplete} disabled={isBusy}>
                  {isCompleting ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : null}
                  Completar
                </Button>
              ) : (
                <Button onClick={handleNext} disabled={isBusy}>
                  {isSaving ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : null}
                  Siguiente
                  <ArrowRight className="ml-2 size-4" />
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Step summary cards */}
      <div className="grid gap-3 sm:grid-cols-4">
        {STEPS.map((s, i) => {
          return (
            <button
              key={s.key}
              onClick={() => setStep(i)}
              className={`text-left p-3 rounded-lg border transition-colors ${
                i === step
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/50"
              }`}
            >
              <div className="flex items-center gap-2">
                <div
                  className={`w-6 h-6 rounded-full text-xs flex items-center justify-center font-medium ${
                    completedSteps.has(s.key)
                      ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                      : i === step
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {completedSteps.has(s.key) ? (
                    <CheckCircle2 className="size-3.5" />
                  ) : (
                    i + 1
                  )}
                </div>
                <span className="text-sm font-medium">{s.title}</span>
              </div>
              {completedSteps.has(s.key) && s.key !== "welcome" && (
                <p className="text-xs text-green-600 mt-1 ml-8">Conectado</p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
