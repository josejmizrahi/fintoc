"use client";

import { useState, useMemo, useRef } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  Loader2,
  Building2,
  Users,
  Link2,
  Settings,
  Plus,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Unplug,
  Shield,
  UserPlus,
  MoreHorizontal,
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
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { PermissionGate } from "@/components/shared/permission-gate";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";

import { api } from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/utils/format";

/* ---------- Query keys ---------- */

const configKeys = {
  all: ["config"] as const,
  users: () => [...configKeys.all, "users"] as const,
  integrations: () => [...configKeys.all, "integrations"] as const,
  company: () => [...configKeys.all, "company"] as const,
};

/* ---------- Zod schemas ---------- */

const companySchema = z.object({
  name: z.string().min(1, "Nombre de empresa requerido"),
  rfc: z.string().min(12, "RFC invalido").max(13),
  address: z.string().optional(),
  phone: z.string().optional(),
});

type CompanyForm = z.infer<typeof companySchema>;

const inviteSchema = z.object({
  email: z.string().email("Email invalido"),
  name: z.string().min(1, "Nombre requerido"),
  role: z.string().min(1, "Selecciona un rol"),
});

type InviteForm = z.infer<typeof inviteSchema>;

const preferencesSchema = z.object({
  currency: z.string(),
  timezone: z.string(),
  date_format: z.string(),
  notify_payments: z.boolean(),
  notify_approvals: z.boolean(),
  notify_overdue: z.boolean(),
  auto_validate_sat: z.boolean(),
  auto_sync_frequency: z.string(),
});

type PreferencesForm = z.infer<typeof preferencesSchema>;

/* ---------- User type ---------- */

interface UserRecord {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  created_at?: string;
}

/* ---------- User Columns ---------- */

function useUserColumns(
  onChangeRole: (id: string, role: string) => void,
  onDeactivate: (id: string) => void
): ColumnDef<UserRecord, any>[] {
  return useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Nombre",
        cell: ({ getValue }) => (
          <span className="font-medium">{getValue<string>()}</span>
        ),
      },
      {
        accessorKey: "email",
        header: "Email",
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{getValue<string>()}</span>
        ),
      },
      {
        accessorKey: "role",
        header: "Rol",
        cell: ({ row }) => {
          const user = row.original;
          return (
            <Select
              value={user.role}
              onValueChange={(v) => onChangeRole(user.id, v)}
            >
              <SelectTrigger className="w-[140px] h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="accountant">Contador</SelectItem>
                <SelectItem value="viewer">Visor</SelectItem>
              </SelectContent>
            </Select>
          );
        },
      },
      {
        accessorKey: "status",
        header: "Estado",
        cell: ({ getValue }) => <StatusBadge status={getValue<string>()} />,
      },
      {
        id: "actions",
        header: () => <span className="text-right block">Acciones</span>,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => onDeactivate(row.original.id)}
                >
                  Desactivar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [onChangeRole, onDeactivate]
  );
}

/* ---------- InviteDialog ---------- */

function InviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();

  const inviteMutation = useMutation({
    mutationFn: (data: any) => api.users.invite(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: configKeys.users() });
      toast.success("Invitacion enviada");
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Error al enviar invitacion");
    },
  });

  const form = useForm<InviteForm>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", name: "", role: "viewer" },
  });

  function onSubmit(data: InviteForm) {
    inviteMutation.mutate(data);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invitar Usuario</DialogTitle>
          <DialogDescription>
            Envia una invitacion por email para unirse a la empresa.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="invite-name">Nombre *</Label>
            <Input
              id="invite-name"
              placeholder="Nombre completo"
              {...form.register("name")}
            />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="invite-email">Email *</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="usuario@empresa.com"
              {...form.register("email")}
            />
            {form.formState.errors.email && (
              <p className="text-xs text-destructive">
                {form.formState.errors.email.message}
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="invite-role">Rol *</Label>
            <Controller
              control={form.control}
              name="role"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="accountant">Contador</SelectItem>
                    <SelectItem value="viewer">Visor</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={inviteMutation.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={inviteMutation.isPending}>
              {inviteMutation.isPending && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Invitar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Integration Status Card ---------- */

function IntegrationCard({
  name,
  provider,
  isConnected,
  lastSync,
  onTest,
  onSync,
  onDisconnect,
  isTesting,
  isSyncing,
}: {
  name: string;
  provider: string;
  isConnected: boolean;
  lastSync?: string;
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
            disabled={isTesting || isSyncing}
          >
            {isSyncing ? (
              <Loader2 className="size-3.5 animate-spin mr-1" />
            ) : (
              <RefreshCw className="size-3.5 mr-1" />
            )}
            Sincronizar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDisconnect}
            disabled={isTesting || isSyncing}
          >
            <Unplug className="size-3.5 mr-1" />
            Desconectar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- Main Page ---------- */

export default function ConfiguracionPage() {
  const queryClient = useQueryClient();
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [deactivateId, setDeactivateId] = useState<string | null>(null);
  const [integrationAction, setIntegrationAction] = useState<{
    provider: string;
    action: "test" | "sync";
  } | null>(null);

  /* ----- Queries ----- */

  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: configKeys.users(),
    queryFn: () => api.users.list(),
    staleTime: 30_000,
  });

  const { data: onboardingStatus } = useQuery({
    queryKey: configKeys.integrations(),
    queryFn: () => api.onboarding.status(),
    staleTime: 30_000,
  });

  const users: UserRecord[] = useMemo(
    () => (Array.isArray(usersData) ? usersData : []),
    [usersData]
  );

  const integrations = onboardingStatus?.integrations ?? {
    odoo: null,
    fintoc: null,
    sat: null,
  };

  /* ----- Mutations ----- */

  const changeRoleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      api.users.updateRole(id, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: configKeys.users() });
      toast.success("Rol actualizado");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Error al cambiar rol");
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.users.deactivate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: configKeys.users() });
      toast.success("Usuario desactivado");
      setDeactivateId(null);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Error al desactivar usuario");
    },
  });

  const testMutation = useMutation({
    mutationFn: (provider: string) =>
      api.onboarding.test(provider, {}),
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message || "Conexion exitosa");
      } else {
        toast.error(data.message || "Error de conexion");
      }
      setIntegrationAction(null);
    },
    onError: () => {
      toast.error("Error de conexion");
      setIntegrationAction(null);
    },
  });

  const syncMutation = useMutation({
    mutationFn: (provider: string) => api.sync.trigger(provider),
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message || "Sincronizacion completada");
        queryClient.invalidateQueries({ queryKey: configKeys.integrations() });
      } else {
        toast.error(data.message || "Error de sincronizacion");
      }
      setIntegrationAction(null);
    },
    onError: () => {
      toast.error("Error de sincronizacion");
      setIntegrationAction(null);
    },
  });

  /* ----- Company Form ----- */

  const companyForm = useForm<CompanyForm>({
    resolver: zodResolver(companySchema),
    defaultValues: { name: "", rfc: "", address: "", phone: "" },
  });

  const saveCompanyMutation = useMutation({
    mutationFn: (data: CompanyForm) =>
      api.onboarding.save("general", {
        companyName: data.name,
        rfc: data.rfc,
        address: data.address || "",
        phone: data.phone || "",
      }),
    onSuccess: () => {
      toast.success("Datos de empresa guardados");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Error al guardar");
    },
  });

  /* ----- Preferences Form ----- */

  const preferencesForm = useForm<PreferencesForm>({
    resolver: zodResolver(preferencesSchema),
    defaultValues: {
      currency: "MXN",
      timezone: "America/Mexico_City",
      date_format: "dd/MM/yyyy",
      notify_payments: true,
      notify_approvals: true,
      notify_overdue: true,
      auto_validate_sat: false,
      auto_sync_frequency: "daily",
    },
  });

  const savePreferencesMutation = useMutation({
    mutationFn: (data: PreferencesForm) =>
      api.onboarding.save("general", data as any),
    onSuccess: () => {
      toast.success("Preferencias guardadas");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Error al guardar preferencias");
    },
  });

  /* ----- User table helpers ----- */

  const handleChangeRole = (id: string, role: string) => {
    changeRoleMutation.mutate({ id, role });
  };

  const handleDeactivate = (id: string) => {
    setDeactivateId(id);
  };

  const userColumns = useUserColumns(handleChangeRole, handleDeactivate);

  return (
    <PermissionGate
      permission="config:write"
      fallback={
        <EmptyState
          icon={Settings}
          title="Acceso restringido"
          description="Solo administradores pueden acceder a la configuracion."
        />
      }
    >
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Configuracion</h1>
          <p className="text-muted-foreground text-sm">
            Administra tu empresa, usuarios, integraciones y preferencias.
          </p>
        </div>

        {/* Vertical Tabs */}
        <Tabs defaultValue="empresa" orientation="vertical" className="flex gap-6">
          <TabsList className="flex flex-col h-auto w-[200px] shrink-0">
            <TabsTrigger value="empresa" className="w-full justify-start">
              <Building2 className="size-4 mr-2" />
              Empresa
            </TabsTrigger>
            <TabsTrigger value="usuarios" className="w-full justify-start">
              <Users className="size-4 mr-2" />
              Usuarios y Roles
            </TabsTrigger>
            <TabsTrigger value="integraciones" className="w-full justify-start">
              <Link2 className="size-4 mr-2" />
              Integraciones
            </TabsTrigger>
            <TabsTrigger value="preferencias" className="w-full justify-start">
              <Settings className="size-4 mr-2" />
              Preferencias
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 min-w-0">
            {/* ---- Tab 1: Empresa ---- */}
            <TabsContent value="empresa" className="mt-0">
              <Card>
                <CardHeader>
                  <CardTitle>Datos de la Empresa</CardTitle>
                  <CardDescription>
                    Informacion general de tu empresa.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form
                    onSubmit={companyForm.handleSubmit((data) =>
                      saveCompanyMutation.mutate(data)
                    )}
                    className="space-y-4"
                  >
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="company-name">Nombre *</Label>
                        <Input
                          id="company-name"
                          placeholder="Mi Empresa S.A. de C.V."
                          {...companyForm.register("name")}
                        />
                        {companyForm.formState.errors.name && (
                          <p className="text-xs text-destructive">
                            {companyForm.formState.errors.name.message}
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="company-rfc">RFC *</Label>
                        <Input
                          id="company-rfc"
                          placeholder="XAXX010101000"
                          maxLength={13}
                          {...companyForm.register("rfc")}
                        />
                        {companyForm.formState.errors.rfc && (
                          <p className="text-xs text-destructive">
                            {companyForm.formState.errors.rfc.message}
                          </p>
                        )}
                      </div>
                      <div className="space-y-2 sm:col-span-2">
                        <Label htmlFor="company-address">Direccion</Label>
                        <Input
                          id="company-address"
                          placeholder="Calle, Colonia, Ciudad, CP"
                          {...companyForm.register("address")}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="company-phone">Telefono</Label>
                        <Input
                          id="company-phone"
                          placeholder="+52 55 1234 5678"
                          {...companyForm.register("phone")}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Logo</Label>
                        <Input type="file" accept="image/*" />
                      </div>
                    </div>
                    <Separator />
                    <div className="flex justify-end">
                      <Button
                        type="submit"
                        disabled={saveCompanyMutation.isPending}
                      >
                        {saveCompanyMutation.isPending && (
                          <Loader2 className="mr-2 size-4 animate-spin" />
                        )}
                        Guardar
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ---- Tab 2: Usuarios y Roles ---- */}
            <TabsContent value="usuarios" className="mt-0">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>Usuarios y Roles</CardTitle>
                    <CardDescription>
                      Gestiona los usuarios de tu empresa y sus permisos.
                    </CardDescription>
                  </div>
                  <Button onClick={() => setInviteDialogOpen(true)}>
                    <UserPlus className="mr-2 size-4" />
                    Invitar
                  </Button>
                </CardHeader>
                <CardContent>
                  <DataTable
                    columns={userColumns}
                    data={users}
                    isLoading={usersLoading}
                    emptyState={
                      <EmptyState
                        icon={Users}
                        title="Sin usuarios"
                        description="Invita a tu equipo para empezar."
                        action={{
                          label: "Invitar usuario",
                          onClick: () => setInviteDialogOpen(true),
                        }}
                      />
                    }
                  />
                </CardContent>
              </Card>
            </TabsContent>

            {/* ---- Tab 3: Integraciones ---- */}
            <TabsContent value="integraciones" className="mt-0">
              <div className="grid gap-4">
                <IntegrationCard
                  name="Odoo ERP"
                  provider="odoo"
                  isConnected={integrations.odoo?.is_connected === true}
                  lastSync={
                    integrations.odoo?.last_sync_at
                      ? formatRelative(integrations.odoo.last_sync_at)
                      : undefined
                  }
                  onTest={() => {
                    setIntegrationAction({ provider: "odoo", action: "test" });
                    testMutation.mutate("odoo");
                  }}
                  onSync={() => {
                    setIntegrationAction({ provider: "odoo", action: "sync" });
                    syncMutation.mutate("odoo");
                  }}
                  onDisconnect={() =>
                    toast.info("Desconectar desde la pagina de onboarding")
                  }
                  isTesting={
                    integrationAction?.provider === "odoo" &&
                    integrationAction?.action === "test" &&
                    testMutation.isPending
                  }
                  isSyncing={
                    integrationAction?.provider === "odoo" &&
                    integrationAction?.action === "sync" &&
                    syncMutation.isPending
                  }
                />
                <IntegrationCard
                  name="Fintoc / Banco"
                  provider="fintoc"
                  isConnected={integrations.fintoc?.is_connected === true}
                  lastSync={
                    integrations.fintoc?.last_sync_at
                      ? formatRelative(integrations.fintoc.last_sync_at)
                      : undefined
                  }
                  onTest={() => {
                    setIntegrationAction({
                      provider: "fintoc",
                      action: "test",
                    });
                    testMutation.mutate("fintoc");
                  }}
                  onSync={() => {
                    setIntegrationAction({
                      provider: "fintoc",
                      action: "sync",
                    });
                    syncMutation.mutate("fintoc");
                  }}
                  onDisconnect={() =>
                    toast.info("Desconectar desde la pagina de onboarding")
                  }
                  isTesting={
                    integrationAction?.provider === "fintoc" &&
                    integrationAction?.action === "test" &&
                    testMutation.isPending
                  }
                  isSyncing={
                    integrationAction?.provider === "fintoc" &&
                    integrationAction?.action === "sync" &&
                    syncMutation.isPending
                  }
                />
                <IntegrationCard
                  name="SAT"
                  provider="sat"
                  isConnected={integrations.sat?.is_connected === true}
                  lastSync={
                    integrations.sat?.last_sync_at
                      ? formatRelative(integrations.sat.last_sync_at)
                      : undefined
                  }
                  onTest={() => {
                    setIntegrationAction({ provider: "sat", action: "test" });
                    testMutation.mutate("sat");
                  }}
                  onSync={() => {
                    setIntegrationAction({ provider: "sat", action: "sync" });
                    syncMutation.mutate("sat");
                  }}
                  onDisconnect={() =>
                    toast.info("Desconectar desde la pagina de onboarding")
                  }
                  isTesting={
                    integrationAction?.provider === "sat" &&
                    integrationAction?.action === "test" &&
                    testMutation.isPending
                  }
                  isSyncing={
                    integrationAction?.provider === "sat" &&
                    integrationAction?.action === "sync" &&
                    syncMutation.isPending
                  }
                />
              </div>
            </TabsContent>

            {/* ---- Tab 4: Preferencias ---- */}
            <TabsContent value="preferencias" className="mt-0">
              <Card>
                <CardHeader>
                  <CardTitle>Preferencias</CardTitle>
                  <CardDescription>
                    Configura moneda, zona horaria, notificaciones y
                    automatizaciones.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form
                    onSubmit={preferencesForm.handleSubmit((data) =>
                      savePreferencesMutation.mutate(data)
                    )}
                    className="space-y-6"
                  >
                    {/* Regional */}
                    <div>
                      <p className="text-sm font-medium mb-4">Regional</p>
                      <div className="grid gap-4 sm:grid-cols-3">
                        <div className="space-y-2">
                          <Label>Moneda</Label>
                          <Controller
                            control={preferencesForm.control}
                            name="currency"
                            render={({ field }) => (
                              <Select
                                value={field.value}
                                onValueChange={field.onChange}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="MXN">MXN</SelectItem>
                                  <SelectItem value="USD">USD</SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Zona horaria</Label>
                          <Controller
                            control={preferencesForm.control}
                            name="timezone"
                            render={({ field }) => (
                              <Select
                                value={field.value}
                                onValueChange={field.onChange}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="America/Mexico_City">
                                    Ciudad de Mexico
                                  </SelectItem>
                                  <SelectItem value="America/Monterrey">
                                    Monterrey
                                  </SelectItem>
                                  <SelectItem value="America/Tijuana">
                                    Tijuana
                                  </SelectItem>
                                  <SelectItem value="America/Cancun">
                                    Cancun
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Formato de fecha</Label>
                          <Controller
                            control={preferencesForm.control}
                            name="date_format"
                            render={({ field }) => (
                              <Select
                                value={field.value}
                                onValueChange={field.onChange}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="dd/MM/yyyy">
                                    dd/MM/yyyy
                                  </SelectItem>
                                  <SelectItem value="MM/dd/yyyy">
                                    MM/dd/yyyy
                                  </SelectItem>
                                  <SelectItem value="yyyy-MM-dd">
                                    yyyy-MM-dd
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                          />
                        </div>
                      </div>
                    </div>

                    <Separator />

                    {/* Notifications */}
                    <div>
                      <p className="text-sm font-medium mb-4">Notificaciones</p>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm">Pagos ejecutados</p>
                            <p className="text-xs text-muted-foreground">
                              Recibir notificacion cuando se ejecuta un pago.
                            </p>
                          </div>
                          <Controller
                            control={preferencesForm.control}
                            name="notify_payments"
                            render={({ field }) => (
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            )}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm">Aprobaciones pendientes</p>
                            <p className="text-xs text-muted-foreground">
                              Notificar cuando hay aprobaciones pendientes.
                            </p>
                          </div>
                          <Controller
                            control={preferencesForm.control}
                            name="notify_approvals"
                            render={({ field }) => (
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            )}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm">Facturas vencidas</p>
                            <p className="text-xs text-muted-foreground">
                              Notificar sobre facturas vencidas.
                            </p>
                          </div>
                          <Controller
                            control={preferencesForm.control}
                            name="notify_overdue"
                            render={({ field }) => (
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            )}
                          />
                        </div>
                      </div>
                    </div>

                    <Separator />

                    {/* Automation */}
                    <div>
                      <p className="text-sm font-medium mb-4">Automatizacion</p>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm">
                              Validacion automatica SAT
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Validar automaticamente CFDIs nuevos contra el
                              SAT.
                            </p>
                          </div>
                          <Controller
                            control={preferencesForm.control}
                            name="auto_validate_sat"
                            render={({ field }) => (
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            )}
                          />
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="flex-1">
                            <p className="text-sm">
                              Frecuencia de sincronizacion
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Cada cuanto sincronizar datos automaticamente.
                            </p>
                          </div>
                          <Controller
                            control={preferencesForm.control}
                            name="auto_sync_frequency"
                            render={({ field }) => (
                              <Select
                                value={field.value}
                                onValueChange={field.onChange}
                              >
                                <SelectTrigger className="w-[160px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="hourly">
                                    Cada hora
                                  </SelectItem>
                                  <SelectItem value="daily">Diario</SelectItem>
                                  <SelectItem value="weekly">
                                    Semanal
                                  </SelectItem>
                                  <SelectItem value="manual">Manual</SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                          />
                        </div>
                      </div>
                    </div>

                    <Separator />

                    <div className="flex justify-end">
                      <Button
                        type="submit"
                        disabled={savePreferencesMutation.isPending}
                      >
                        {savePreferencesMutation.isPending && (
                          <Loader2 className="mr-2 size-4 animate-spin" />
                        )}
                        Guardar Preferencias
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>
          </div>
        </Tabs>

        {/* Invite Dialog */}
        <InviteDialog
          open={inviteDialogOpen}
          onOpenChange={setInviteDialogOpen}
        />

        {/* Deactivate Confirm */}
        <ConfirmDialog
          open={!!deactivateId}
          onOpenChange={(open) => {
            if (!open) setDeactivateId(null);
          }}
          title="Desactivar Usuario"
          description="Este usuario perdera acceso a la plataforma. Puedes reactivarlo despues."
          confirmLabel="Desactivar"
          variant="destructive"
          onConfirm={() => {
            if (deactivateId) deactivateMutation.mutate(deactivateId);
          }}
          loading={deactivateMutation.isPending}
        />
      </div>
    </PermissionGate>
  );
}
