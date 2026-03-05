"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowRight,
  ArrowLeft,
  Landmark,
  ShieldCheck,
  Server,
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

/* ---------- Step definitions ---------- */

const STEPS = [
  {
    key: "odoo" as const,
    title: "Conectar Odoo",
    description: "Conecta tu ERP para sincronizar clientes, proveedores y facturas.",
    icon: Server,
  },
  {
    key: "fintoc" as const,
    title: "Conectar Fintoc",
    description: "Configura pagos SPEI y consulta de movimientos bancarios.",
    icon: Landmark,
  },
  {
    key: "sat" as const,
    title: "Conectar SAT",
    description: "Conecta con el SAT via Syntage para descargar CFDIs, declaraciones y mas.",
    icon: ShieldCheck,
  },
];

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
}: {
  steps: typeof STEPS;
  currentStep: number;
  completedSteps: Set<string>;
}) {
  return (
    <div className="flex items-center gap-0 w-full">
      {steps.map((step, i) => {
        const isCompleted = completedSteps.has(step.key);
        const isCurrent = i === currentStep;

        return (
          <div key={step.key} className="flex items-center flex-1">
            <div className="flex flex-col items-center flex-1">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium border-2 transition-colors ${
                  isCompleted
                    ? "border-green-600 bg-green-600 text-white"
                    : isCurrent
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/30 bg-background text-muted-foreground"
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
            </div>
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
  const [step, setStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());
  const [testResults, setTestResults] = useState<Record<string, TestResult | null>>({
    odoo: null,
    fintoc: null,
    sat: null,
  });

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

  /* ----- Save + Complete Mutation ----- */

  const saveMutation = useMutation({
    mutationFn: (params: { provider: string; config: Record<string, string> }) =>
      api.onboarding.save(params.provider, params.config),
  });

  const completeMutation = useMutation({
    mutationFn: () => api.onboarding.complete(),
    onSuccess: () => {
      toast.success("Configuracion completada");
      router.push("/");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Error al completar onboarding");
    },
  });

  /* ----- Handlers ----- */

  async function handleTestOdoo() {
    const valid = await odooForm.trigger();
    if (!valid) return;
    const values = odooForm.getValues();
    testConnection.mutate({
      provider: "odoo",
      config: {
        url: values.url,
        database: values.database,
        user: values.user,
        password: values.apiKey,
      },
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

    // First save Syntage API key, then test connection via Syntage
    try {
      await api.sat.syntage.saveConfig({ syntageApiKey: values.syntageApiKey });
    } catch { /* will fail on test if key is bad */ }

    testConnection.mutate({
      provider: "sat",
      config: {
        syntageApiKey: values.syntageApiKey,
        rfcEmisor: values.rfcEmisor,
        fielPassword: values.fielPassword,
      },
    });
  }

  function handleNext() {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    }
  }

  function handleBack() {
    if (step > 0) {
      setStep(step - 1);
    }
  }

  async function handleComplete() {
    // Save all configs then complete
    try {
      const odooValues = odooForm.getValues();
      const fintocValues = fintocForm.getValues();
      const satValues = satForm.getValues();

      await saveMutation.mutateAsync({
        provider: "odoo",
        config: {
          url: odooValues.url,
          database: odooValues.database,
          user: odooValues.user,
          password: odooValues.apiKey,
        },
      });
      await saveMutation.mutateAsync({
        provider: "fintoc",
        config: { secretKey: fintocValues.secretKey },
      });
      await saveMutation.mutateAsync({
        provider: "sat",
        config: {
          syntageApiKey: satValues.syntageApiKey,
          rfcEmisor: satValues.rfcEmisor,
          fielPassword: satValues.fielPassword,
        },
      });

      completeMutation.mutate();
    } catch (err: any) {
      toast.error(err.message || "Error al guardar configuracion");
    }
  }

  const isLastStep = step === STEPS.length - 1;
  const testResult = testResults[currentStep.key];
  const isConnected = testResult?.success === true;
  const isTesting = testConnection.isPending;
  const isCompleting = completeMutation.isPending || saveMutation.isPending;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Configuracion Inicial</h1>
        <p className="text-muted-foreground">
          Conecta tus servicios para empezar a usar la plataforma.
        </p>
      </div>

      {/* Stepper */}
      <Stepper
        steps={STEPS}
        currentStep={step}
        completedSteps={completedSteps}
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
          </CardTitle>
          <CardDescription>{currentStep.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
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
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
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
                <div className="rounded-lg border border-green-200 bg-green-50 p-4 space-y-2">
                  <p className="text-sm font-medium text-green-800">Syntage conectado</p>
                  {testResult.rfc && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">RFC:</span>
                      <span className="font-mono">{testResult.rfc}</span>
                    </div>
                  )}
                  {testResult.message && (
                    <p className="text-xs text-green-700">{testResult.message}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Test result message */}
          {testResult?.message && (
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
              <Button
                variant="outline"
                onClick={
                  currentStep.key === "odoo"
                    ? handleTestOdoo
                    : currentStep.key === "fintoc"
                    ? handleTestFintoc
                    : handleTestSat
                }
                disabled={isTesting || isCompleting}
              >
                {isTesting ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : null}
                Probar Conexion
              </Button>
            </div>

            <div className="flex gap-3">
              {step > 0 && (
                <Button variant="ghost" onClick={handleBack} disabled={isCompleting}>
                  <ArrowLeft className="mr-2 size-4" />
                  Anterior
                </Button>
              )}
              {isLastStep ? (
                <Button onClick={handleComplete} disabled={isCompleting}>
                  {isCompleting ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : null}
                  Completar
                </Button>
              ) : (
                <Button onClick={handleNext}>
                  Siguiente
                  <ArrowRight className="ml-2 size-4" />
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Step summary cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        {STEPS.map((s, i) => {
          const result = testResults[s.key];
          const StepIcon = s.icon;
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
                      ? "bg-green-100 text-green-700"
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
              {completedSteps.has(s.key) && (
                <p className="text-xs text-green-600 mt-1 ml-8">Conectado</p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
