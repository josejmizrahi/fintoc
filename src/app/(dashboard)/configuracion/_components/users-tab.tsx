"use client";

import { useState, useMemo } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, Users, UserPlus, MoreHorizontal, Shield } from "lucide-react";

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

import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";

import { api } from "@/lib/api";

/* ---------- Types & Schemas ---------- */

interface UserRecord {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  created_at?: string;
}

const inviteSchema = z.object({
  email: z.string().email("Email invalido"),
  name: z.string().min(1, "Nombre requerido"),
  role: z.string().min(1, "Selecciona un rol"),
});

type InviteForm = z.infer<typeof inviteSchema>;

const QUERY_KEY = ["config", "users"] as const;

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  accountant: "Contador",
  viewer: "Visor",
};

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
    mutationFn: (data: InviteForm) => api.users.invite(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success("Invitacion enviada");
      onOpenChange(false);
    },
    onError: (err: Error) =>
      toast.error(err.message || "Error al enviar invitacion"),
  });

  const form = useForm<InviteForm>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", name: "", role: "viewer" },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invitar Usuario</DialogTitle>
          <DialogDescription>
            Envia una invitacion por email para unirse a la empresa.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit((data) => inviteMutation.mutate(data))}
          className="grid gap-4 py-2"
        >
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

          <DialogFooter className="pt-2 flex-col sm:flex-row gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={inviteMutation.isPending}
              className="w-full sm:w-auto"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={inviteMutation.isPending}
              className="w-full sm:w-auto"
            >
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

/* ---------- Mobile User Card ---------- */

function UserCard({
  user,
  onChangeRole,
  onDeactivate,
}: {
  user: UserRecord;
  onChangeRole: (id: string, role: string) => void;
  onDeactivate: (id: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate">{user.name}</p>
          <StatusBadge status={user.status} />
        </div>
        <p className="text-xs text-muted-foreground truncate">{user.email}</p>
        <div className="mt-1.5">
          <Badge variant="outline" className="text-[10px]">
            <Shield className="size-3 mr-1" />
            {ROLE_LABELS[user.role] || user.role}
          </Badge>
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="shrink-0 size-8">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onChangeRole(user.id, "admin")}>
            Hacer Admin
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onChangeRole(user.id, "accountant")}
          >
            Hacer Contador
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onChangeRole(user.id, "viewer")}>
            Hacer Visor
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive"
            onClick={() => onDeactivate(user.id)}
          >
            Desactivar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/* ---------- UsersTab ---------- */

export function UsersTab() {
  const queryClient = useQueryClient();
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [deactivateId, setDeactivateId] = useState<string | null>(null);

  const { data: usersData, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api.users.list(),
    staleTime: 30_000,
  });

  const users: UserRecord[] = useMemo(
    () => (Array.isArray(usersData) ? usersData : []),
    [usersData]
  );

  const changeRoleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      api.users.updateRole(id, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success("Rol actualizado");
    },
    onError: (err: Error) =>
      toast.error(err.message || "Error al cambiar rol"),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.users.deactivate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success("Usuario desactivado");
      setDeactivateId(null);
    },
    onError: (err: Error) =>
      toast.error(err.message || "Error al desactivar usuario"),
  });

  const handleChangeRole = (id: string, role: string) =>
    changeRoleMutation.mutate({ id, role });
  const handleDeactivate = (id: string) => setDeactivateId(id);

  /* Desktop columns */
  const columns: ColumnDef<UserRecord, any>[] = useMemo(
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
              onValueChange={(v) => handleChangeRole(user.id, v)}
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
                  onClick={() => handleDeactivate(row.original.id)}
                >
                  Desactivar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [changeRoleMutation]
  );

  const emptyState = (
    <EmptyState
      icon={Users}
      title="Sin usuarios"
      description="Invita a tu equipo para empezar."
      action={{
        label: "Invitar usuario",
        onClick: () => setInviteDialogOpen(true),
      }}
    />
  );

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
              <Users className="size-4 text-primary" />
            </div>
            <div>
              <CardTitle>Usuarios y Roles</CardTitle>
              <CardDescription>
                Gestiona los usuarios de tu empresa y sus permisos.
              </CardDescription>
            </div>
          </div>
          <Button
            onClick={() => setInviteDialogOpen(true)}
            className="w-full sm:w-auto"
          >
            <UserPlus className="mr-2 size-4" />
            Invitar
          </Button>
        </CardHeader>
        <CardContent>
          {/* Mobile: card list */}
          <div className="block md:hidden">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : users.length === 0 ? (
              emptyState
            ) : (
              <div className="grid gap-2">
                {users.map((user) => (
                  <UserCard
                    key={user.id}
                    user={user}
                    onChangeRole={handleChangeRole}
                    onDeactivate={handleDeactivate}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Desktop: table */}
          <div className="hidden md:block">
            <DataTable
              columns={columns}
              data={users}
              isLoading={isLoading}
              emptyState={emptyState}
            />
          </div>
        </CardContent>
      </Card>

      <InviteDialog
        open={inviteDialogOpen}
        onOpenChange={setInviteDialogOpen}
      />

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
    </>
  );
}
