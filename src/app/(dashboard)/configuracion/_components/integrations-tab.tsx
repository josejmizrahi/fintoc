"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  Loader2,
  Settings,
  CheckCircle2,
  RefreshCw,
  Unplug,
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

const QUERY_KEY = ["config", "integrations"] as const;

/* ---------- Integration Card ---------- */

function IntegrationCard({
  name,
  isConnected,
  lastSync,
  onEdit,
  onTest,
  onSync,
  onDisconnect,
  isTesting,
  isSyncing,
}: {
  name: string;
  isConnected: boolean;
  lastSync?: string;
  onEdit: () => void;
  onTest: () => void;
  onSync: () => void;
  onDisconnect: () => void;
  isTesting: boolean;
  isSyncing: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{name}</CardTitle>
          {isConnected ? (
            <Badge className="bg-green-600 text-white">Conectado</Badge>
          ) : (
            <Badge variant="secondary">Desconectado</Badge>
          )}
        </div>
        {lastSync && (
          <CardDescription>
            Ultima sincronizacion: {lastSync}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Settings className="size-3.5 mr-1" />
            {isConnected ? "Editar" : "Configurar"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onTest}
            disabled={isTesting || isSyncing}
          >
            {isTesting ? (
              <Loader2 className="size-3.5 animate-spin mr-1" />
            ) : (
              <CheckCircle2 className="size-3.5 mr-1" />
            )}
            Probar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onSync}
            disabled={isTesting || isSyncing || !isConnected}
          >
            {isSyncing ? (
              <Loader2 className="size-3.5 animate-spin mr-1" />
            ) : (
              <RefreshCw className="size-3.5 mr-1" />
            )}
            Sincronizar
          </Button>
          {isConnected && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDisconnect}
              disabled={isTesting || isSyncing}
              className="text-destructive hover:text-destructive"
            >
              <Unplug className="size-3.5 mr-1" />
              Desconectar
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
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const form = useForm({
    defaultValues: { url: "", database: "", user: "", apiKey: "" },
  });

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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Configurar Odoo</DialogTitle>
          <DialogDescription>
            Ingresa las credenciales de tu instancia Odoo.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-4 sm:grid-cols-2">
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
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={testMutation.isPending}
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
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const form = useForm({ defaultValues: { secretKey: "" } });

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
      <DialogContent className="sm:max-w-md">
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
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={testMutation.isPending}
            onClick={() => testMutation.mutate(form.getValues())}
          >
            {testMutation.isPending && (
              <Loader2 className="size-4 animate-spin mr-2" />
            )}
            Probar
          </Button>
          <Button
            disabled={saveMutation.isPending}
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
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const form = useForm({
    defaultValues: { syntageApiKey: "", rfcEmisor: "" },
  });

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
    onSuccess: (data: any) => {
      if (data.ok)
        toast.success(
          `Syntage conectado — ${data.taxpayers} contribuyentes, ${data.credentials} credenciales`
        );
      else toast.error(data.error || "Error de conexion con Syntage");
    },
    onError: () => toast.error("Error de conexion con Syntage"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
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
                className="underline"
              >
                app.syntage.com
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
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={testMutation.isPending}
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
  { key: "odoo", name: "Odoo ERP" },
  { key: "fintoc", name: "Fintoc / Banco" },
  { key: "sat", name: "SAT / Syntage" },
] as const;

type ProviderKey = (typeof PROVIDERS)[number]["key"];

const EDIT_DIALOGS: Record<
  ProviderKey,
  React.ComponentType<{
    open: boolean;
    onOpenChange: (v: boolean) => void;
    onSaved: () => void;
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
    action: "test" | "sync";
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
        toast.success(data.message || "Sincronizacion completada");
        queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      } else {
        toast.error(data.message || "Error de sincronizacion");
      }
      setActiveAction(null);
    },
    onError: () => {
      toast.error("Error de sincronizacion");
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
        {PROVIDERS.map(({ key, name }) => {
          const info = integrations[key];
          return (
            <IntegrationCard
              key={key}
              name={name}
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
            />
          );
        })}
      </div>

      {/* Edit Dialogs */}
      {PROVIDERS.map(({ key }) => {
        const EditDialog = EDIT_DIALOGS[key];
        return (
          <EditDialog
            key={key}
            open={editingProvider === key}
            onOpenChange={(open) => {
              if (!open) setEditingProvider(null);
            }}
            onSaved={invalidateIntegrations}
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
