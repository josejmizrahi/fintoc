"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  Loader2,
  Settings,
  CheckCircle2,
  RefreshCw,
  Unplug,
  ExternalLink,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";

import { api } from "@/lib/api";
import { formatRelative } from "@/lib/utils/format";
import { vendorKeys } from "@/lib/hooks/use-vendors";
import { customerKeys } from "@/lib/hooks/use-customers";

const QUERY_KEY = ["config", "integrations"] as const;

/* ---------- Integration Card ---------- */

function IntegrationCard({
  name,
  description,
  isConnected,
  lastSync,
  onEdit,
  onTest,
  onSync,
  onSyncPartners,
  onDisconnect,
  isTesting,
  isSyncing,
  isSyncingPartners,
}: {
  name: string;
  description: string;
  isConnected: boolean;
  lastSync?: string;
  onEdit: () => void;
  onTest: () => void;
  onSync: () => void;
  onSyncPartners?: () => void;
  onDisconnect: () => void;
  isTesting: boolean;
  isSyncing: boolean;
  isSyncingPartners?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base">{name}</CardTitle>
            <CardDescription className="mt-0.5 text-xs">
              {description}
            </CardDescription>
          </div>
          {isConnected ? (
            <Badge className="bg-green-600 text-white shrink-0">
              Conectado
            </Badge>
          ) : (
            <Badge variant="secondary" className="shrink-0">
              Desconectado
            </Badge>
          )}
        </div>
        {lastSync && (
          <p className="text-xs text-muted-foreground mt-1">
            Ultima sincronizacion: {lastSync}
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Settings className="size-3.5 mr-1.5" />
            {isConnected ? "Editar" : "Configurar"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onTest}
            disabled={isTesting || isSyncing || isSyncingPartners}
          >
            {isTesting ? (
              <Loader2 className="size-3.5 animate-spin mr-1.5" />
            ) : (
              <CheckCircle2 className="size-3.5 mr-1.5" />
            )}
            Probar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onSync}
            disabled={isTesting || isSyncing || isSyncingPartners || !isConnected}
          >
            {isSyncing ? (
              <Loader2 className="size-3.5 animate-spin mr-1.5" />
            ) : (
              <RefreshCw className="size-3.5 mr-1.5" />
            )}
            Sincronizar
          </Button>
          {onSyncPartners && (
            <Button
              variant="outline"
              size="sm"
              onClick={onSyncPartners}
              disabled={isTesting || isSyncing || isSyncingPartners || !isConnected}
              title="Actualiza la lista de proveedores y clientes desde Odoo"
            >
              {isSyncingPartners ? (
                <Loader2 className="size-3.5 animate-spin mr-1.5" />
              ) : (
                <RefreshCw className="size-3.5 mr-1.5" />
              )}
              Proveedores y clientes
            </Button>
          )}
          {isConnected && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDisconnect}
              disabled={isTesting || isSyncing || isSyncingPartners}
              className="text-destructive hover:text-destructive"
            >
              <Unplug className="size-3.5 mr-1.5" />
              <span className="hidden sm:inline">Desconectar</span>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- Edit Dialogs ---------- */

function OdooEditDialog({
  open,
  onOpenChange,
  onSaved,
  savedConfig,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
  savedConfig?: Record<string, string> | null;
}) {
  const form = useForm({
    defaultValues: { url: "", database: "", user: "", apiKey: "" },
  });

  // Pre-fill with saved config when dialog opens
  useEffect(() => {
    if (open && savedConfig) {
      form.reset({
        url: savedConfig.url || "",
        database: savedConfig.database || "",
        user: savedConfig.user || "",
        apiKey: savedConfig.password || "",
      });
    } else if (open && !savedConfig) {
      form.reset({ url: "", database: "", user: "", apiKey: "" });
    }
  }, [open, savedConfig, form]);

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, string>) =>
      api.onboarding.save("odoo", data),
    onSuccess: () => {
      toast.success("Credenciales de Odoo guardadas");
      onSaved();
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message || "Error al guardar"),
  });

  const testMutation = useMutation({
    mutationFn: (data: Record<string, string>) =>
      api.onboarding.test("odoo", data),
    onSuccess: (data) => {
      if (data.success) toast.success(data.message || "Conexion exitosa");
      else toast.error(data.message || "Error de conexion");
    },
    onError: () => toast.error("Error de conexion"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configurar Odoo</DialogTitle>
          <DialogDescription>
            Ingresa las credenciales de tu instancia Odoo.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>URL *</Label>
              <Input
                placeholder="https://mi-empresa.odoo.com"
                {...form.register("url")}
              />
            </div>
            <div className="space-y-2">
              <Label>Base de datos *</Label>
              <Input
                placeholder="mi_empresa_db"
                {...form.register("database")}
              />
            </div>
            <div className="space-y-2">
              <Label>Usuario *</Label>
              <Input
                placeholder="admin@empresa.com"
                {...form.register("user")}
              />
            </div>
            <div className="space-y-2">
              <Label>API Key *</Label>
              <Input
                type="password"
                placeholder="••••••••"
                {...form.register("apiKey")}
              />
            </div>
          </div>
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={testMutation.isPending}
            className="w-full sm:w-auto"
            onClick={() => {
              const v = form.getValues();
              testMutation.mutate({
                url: v.url,
                database: v.database,
                user: v.user,
                password: v.apiKey,
              });
            }}
          >
            {testMutation.isPending && (
              <Loader2 className="size-4 animate-spin mr-2" />
            )}
            Probar
          </Button>
          <Button
            disabled={saveMutation.isPending}
            className="w-full sm:w-auto"
            onClick={() => {
              const v = form.getValues();
              saveMutation.mutate({
                url: v.url,
                database: v.database,
                user: v.user,
                password: v.apiKey,
              });
            }}
          >
            {saveMutation.isPending && (
              <Loader2 className="size-4 animate-spin mr-2" />
            )}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FintocEditDialog({
  open,
  onOpenChange,
  onSaved,
  savedConfig,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
  savedConfig?: Record<string, string> | null;
}) {
  const form = useForm({ defaultValues: { secretKey: "" } });

  useEffect(() => {
    if (open && savedConfig) {
      form.reset({ secretKey: savedConfig.secretKey || "" });
    } else if (open && !savedConfig) {
      form.reset({ secretKey: "" });
    }
  }, [open, savedConfig, form]);

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, string>) =>
      api.onboarding.save("fintoc", data),
    onSuccess: () => {
      toast.success("Credenciales de Fintoc guardadas");
      onSaved();
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message || "Error al guardar"),
  });

  const testMutation = useMutation({
    mutationFn: (data: Record<string, string>) =>
      api.onboarding.test("fintoc", data),
    onSuccess: (data) => {
      if (data.success) toast.success(data.message || "Conexion exitosa");
      else toast.error(data.message || "Error de conexion");
    },
    onError: () => toast.error("Error de conexion"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configurar Fintoc</DialogTitle>
          <DialogDescription>
            Ingresa tu Secret Key de Fintoc para pagos SPEI y movimientos
            bancarios.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="space-y-2">
            <Label>Secret Key *</Label>
            <Input
              type="password"
              placeholder="sk_live_..."
              {...form.register("secretKey")}
            />
          </div>
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={testMutation.isPending}
            className="w-full sm:w-auto"
            onClick={() => testMutation.mutate(form.getValues())}
          >
            {testMutation.isPending && (
              <Loader2 className="size-4 animate-spin mr-2" />
            )}
            Probar
          </Button>
          <Button
            disabled={saveMutation.isPending}
            className="w-full sm:w-auto"
            onClick={() => saveMutation.mutate(form.getValues())}
          >
            {saveMutation.isPending && (
              <Loader2 className="size-4 animate-spin mr-2" />
            )}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SatEditDialog({
  open,
  onOpenChange,
  onSaved,
  savedConfig,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
  savedConfig?: Record<string, string> | null;
}) {
  const form = useForm({
    defaultValues: { syntageApiKey: "", rfcEmisor: "" },
  });

  useEffect(() => {
    if (open && savedConfig) {
      form.reset({
        syntageApiKey: savedConfig.syntageApiKey || "",
        rfcEmisor: savedConfig.rfcEmisor || "",
      });
    } else if (open && !savedConfig) {
      form.reset({ syntageApiKey: "", rfcEmisor: "" });
    }
  }, [open, savedConfig, form]);

  const saveMutation = useMutation({
    mutationFn: async (data: Record<string, string>) => {
      await api.sat.syntage.saveConfig({
        syntageApiKey: data.syntageApiKey,
      });
      await api.onboarding.save("sat", data);
    },
    onSuccess: () => {
      toast.success("Configuracion SAT/Syntage guardada");
      onSaved();
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message || "Error al guardar"),
  });

  const testMutation = useMutation({
    mutationFn: () => api.sat.syntage.status(),
    onSuccess: (data: Record<string, unknown>) => {
      if (data.ok)
        toast.success(
          `Syntage conectado — ${data.taxpayers} contribuyentes, ${data.credentials} credenciales`
        );
      else toast.error((data.error as string) || "Error de conexion con Syntage");
    },
    onError: () => toast.error("Error de conexion con Syntage"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configurar SAT via Syntage</DialogTitle>
          <DialogDescription>
            Syntage se conecta al SAT para descargar CFDIs, declaraciones y
            mas.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="space-y-2">
            <Label>API Key de Syntage *</Label>
            <Input
              type="password"
              placeholder="sk_live_..."
              {...form.register("syntageApiKey")}
            />
            <p className="text-xs text-muted-foreground">
              Obten tu API Key en{" "}
              <a
                href="https://app.syntage.com"
                target="_blank"
                rel="noopener"
                className="underline inline-flex items-center gap-0.5"
              >
                app.syntage.com
                <ExternalLink className="size-3" />
              </a>
            </p>
          </div>
          <div className="space-y-2">
            <Label>RFC</Label>
            <Input
              placeholder="XAXX010101000"
              maxLength={13}
              {...form.register("rfcEmisor", {
                onChange: (e) => {
                  e.target.value = e.target.value.toUpperCase();
                },
              })}
            />
          </div>
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={testMutation.isPending}
            className="w-full sm:w-auto"
            onClick={() => {
              const v = form.getValues();
              if (v.syntageApiKey) {
                api.sat.syntage
                  .saveConfig({ syntageApiKey: v.syntageApiKey })
                  .then(() => testMutation.mutate())
                  .catch(() => testMutation.mutate());
              } else {
                toast.error("Ingresa una API Key primero");
              }
            }}
          >
            {testMutation.isPending && (
              <Loader2 className="size-4 animate-spin mr-2" />
            )}
            Probar
          </Button>
          <Button
            disabled={saveMutation.isPending}
            className="w-full sm:w-auto"
            onClick={() => saveMutation.mutate(form.getValues())}
          >
            {saveMutation.isPending && (
              <Loader2 className="size-4 animate-spin mr-2" />
            )}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Provider Config ---------- */

const PROVIDERS = [
  {
    key: "odoo",
    name: "Odoo ERP",
    description: "Sincroniza facturas, proveedores y clientes desde Odoo.",
  },
  {
    key: "fintoc",
    name: "Fintoc / Banco",
    description: "Pagos SPEI, movimientos bancarios y saldos en tiempo real.",
  },
  {
    key: "sat",
    name: "SAT / Syntage",
    description:
      "Descarga CFDIs, valida estatus y consulta lista EFOS del SAT.",
  },
] as const;

type ProviderKey = (typeof PROVIDERS)[number]["key"];

const EDIT_DIALOGS: Record<
  ProviderKey,
  React.ComponentType<{
    open: boolean;
    onOpenChange: (v: boolean) => void;
    onSaved: () => void;
    savedConfig?: Record<string, string> | null;
  }>
> = {
  odoo: OdooEditDialog,
  fintoc: FintocEditDialog,
  sat: SatEditDialog,
};

/* ---------- IntegrationsTab ---------- */

export function IntegrationsTab() {
  const queryClient = useQueryClient();
  const [editingProvider, setEditingProvider] = useState<ProviderKey | null>(
    null
  );
  const [disconnectProvider, setDisconnectProvider] =
    useState<ProviderKey | null>(null);
  const [activeAction, setActiveAction] = useState<{
    provider: ProviderKey;
    action: "test" | "sync" | "syncPartners";
  } | null>(null);

  const { data: onboardingStatus } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api.onboarding.status(),
    staleTime: 30_000,
  });

  const integrations = onboardingStatus?.integrations ?? {
    odoo: null,
    fintoc: null,
    sat: null,
  };

  const testMutation = useMutation({
    mutationFn: (provider: string) => api.onboarding.test(provider, {}),
    onSuccess: (data) => {
      if (data.success) toast.success(data.message || "Conexion exitosa");
      else toast.error(data.message || "Error de conexion");
      setActiveAction(null);
    },
    onError: () => {
      toast.error("Error de conexion");
      setActiveAction(null);
    },
  });

  const syncMutation = useMutation({
    mutationFn: (provider: string) => api.sync.trigger(provider),
    onSuccess: (data) => {
      if (data.success) {
        const result = data.data;
        const msg = result?.recordsSynced != null
          ? `Sincronizacion completada — ${result.recordsSynced} registros`
          : data.message || "Sincronizacion completada";
        toast.success(msg);
        queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      } else {
        const errMsg = data.data?.errors?.[0]?.message || data.message || "Error de sincronizacion";
        toast.error(errMsg);
      }
      setActiveAction(null);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Error de sincronizacion");
      setActiveAction(null);
    },
  });

  const odooPartnersMutation = useMutation({
    mutationFn: () => api.sync.odooPartners(),
    onSuccess: (data: { data?: { vendors_synced?: number; customers_synced?: number; errors?: string[] } }) => {
      const d = data?.data;
      const vendors = d?.vendors_synced ?? 0;
      const customers = d?.customers_synced ?? 0;
      if (d?.errors?.length) {
        toast.warning(`Proveedores y clientes: ${vendors} proveedores, ${customers} clientes. Algunos errores: ${d.errors.slice(0, 2).join("; ")}`);
      } else {
        toast.success(`Proveedores y clientes actualizados — ${vendors} proveedores, ${customers} clientes`);
      }
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: vendorKeys.all });
      queryClient.invalidateQueries({ queryKey: customerKeys.all });
      setActiveAction(null);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Error al sincronizar proveedores y clientes");
      setActiveAction(null);
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: (provider: string) =>
      api.onboarding.save(provider, { _disconnect: "true" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success("Integracion desconectada");
      setDisconnectProvider(null);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Error al desconectar");
      setDisconnectProvider(null);
    },
  });

  const invalidateIntegrations = () =>
    queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  return (
    <>
      <div className="grid gap-4">
        {PROVIDERS.map(({ key, name, description }) => {
          const info = integrations[key];
          return (
            <IntegrationCard
              key={key}
              name={name}
              description={description}
              isConnected={info?.is_connected === true}
              lastSync={
                info?.last_sync_at
                  ? formatRelative(info.last_sync_at)
                  : undefined
              }
              onEdit={() => setEditingProvider(key)}
              onTest={() => {
                setActiveAction({ provider: key, action: "test" });
                testMutation.mutate(key);
              }}
              onSync={() => {
                setActiveAction({ provider: key, action: "sync" });
                syncMutation.mutate(key);
              }}
              onSyncPartners={
                key === "odoo"
                  ? () => {
                      setActiveAction({ provider: key, action: "syncPartners" });
                      odooPartnersMutation.mutate();
                    }
                  : undefined
              }
              onDisconnect={() => setDisconnectProvider(key)}
              isTesting={
                activeAction?.provider === key &&
                activeAction?.action === "test" &&
                testMutation.isPending
              }
              isSyncing={
                activeAction?.provider === key &&
                activeAction?.action === "sync" &&
                syncMutation.isPending
              }
              isSyncingPartners={
                activeAction?.provider === "odoo" &&
                activeAction?.action === "syncPartners" &&
                odooPartnersMutation.isPending
              }
            />
          );
        })}
      </div>

      {/* Edit Dialogs */}
      {PROVIDERS.map(({ key }) => {
        const EditDialog = EDIT_DIALOGS[key];
        const info = integrations[key];
        return (
          <EditDialog
            key={key}
            open={editingProvider === key}
            onOpenChange={(open) => {
              if (!open) setEditingProvider(null);
            }}
            onSaved={invalidateIntegrations}
            savedConfig={info?.config as Record<string, string> | null}
          />
        );
      })}

      {/* Disconnect Confirm */}
      <ConfirmDialog
        open={!!disconnectProvider}
        onOpenChange={(open) => {
          if (!open) setDisconnectProvider(null);
        }}
        title="Desconectar Integracion"
        description={`Se eliminaran las credenciales de ${
          disconnectProvider === "odoo"
            ? "Odoo"
            : disconnectProvider === "fintoc"
              ? "Fintoc"
              : "SAT/Syntage"
        }. Los datos sincronizados se conservan.`}
        confirmLabel="Desconectar"
        variant="destructive"
        onConfirm={() => {
          if (disconnectProvider)
            disconnectMutation.mutate(disconnectProvider);
        }}
        loading={disconnectMutation.isPending}
      />
    </>
  );
}
