"use client";

import { Loader2, Settings } from "lucide-react";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";

import { api } from "@/lib/api";

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

/* ---------- Toggle row ---------- */

function ToggleRow({
  label,
  description,
  control,
  name,
}: {
  label: string;
  description: string;
  control: any;
  name: keyof PreferencesForm;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <Switch
            checked={field.value as boolean}
            onCheckedChange={field.onChange}
            className="shrink-0"
          />
        )}
      />
    </div>
  );
}

/* ---------- PreferencesTab ---------- */

export function PreferencesTab() {
  const form = useForm<PreferencesForm>({
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

  const saveMutation = useMutation({
    mutationFn: (data: PreferencesForm) =>
      api.onboarding.save("general", data as any),
    onSuccess: () => toast.success("Preferencias guardadas"),
    onError: (err: Error) =>
      toast.error(err.message || "Error al guardar preferencias"),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
            <Settings className="size-4 text-primary" />
          </div>
          <div>
            <CardTitle>Preferencias</CardTitle>
            <CardDescription>
              Configura moneda, zona horaria, notificaciones y
              automatizaciones.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={form.handleSubmit((data) => saveMutation.mutate(data))}
          className="space-y-6"
        >
          {/* Regional */}
          <div>
            <p className="text-sm font-medium mb-4">Regional</p>
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <Label>Moneda</Label>
                <Controller
                  control={form.control}
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
                  control={form.control}
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
                        <SelectItem value="America/Cancun">Cancun</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div className="space-y-2">
                <Label>Formato de fecha</Label>
                <Controller
                  control={form.control}
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
                        <SelectItem value="dd/MM/yyyy">dd/MM/yyyy</SelectItem>
                        <SelectItem value="MM/dd/yyyy">MM/dd/yyyy</SelectItem>
                        <SelectItem value="yyyy-MM-dd">yyyy-MM-dd</SelectItem>
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
              <ToggleRow
                label="Pagos ejecutados"
                description="Recibir notificacion cuando se ejecuta un pago."
                control={form.control}
                name="notify_payments"
              />
              <ToggleRow
                label="Aprobaciones pendientes"
                description="Notificar cuando hay aprobaciones pendientes."
                control={form.control}
                name="notify_approvals"
              />
              <ToggleRow
                label="Facturas vencidas"
                description="Notificar sobre facturas vencidas."
                control={form.control}
                name="notify_overdue"
              />
            </div>
          </div>

          <Separator />

          {/* Automation */}
          <div>
            <p className="text-sm font-medium mb-4">Automatizacion</p>
            <div className="space-y-4">
              <ToggleRow
                label="Validacion automatica SAT"
                description="Validar automaticamente CFDIs nuevos contra el SAT."
                control={form.control}
                name="auto_validate_sat"
              />
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm">Frecuencia de sincronizacion</p>
                  <p className="text-xs text-muted-foreground">
                    Cada cuanto sincronizar datos automaticamente.
                  </p>
                </div>
                <Controller
                  control={form.control}
                  name="auto_sync_frequency"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <SelectTrigger className="w-full sm:w-[160px] shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="hourly">Cada hora</SelectItem>
                        <SelectItem value="daily">Diario</SelectItem>
                        <SelectItem value="weekly">Semanal</SelectItem>
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
              disabled={saveMutation.isPending}
              className="w-full sm:w-auto"
            >
              {saveMutation.isPending && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Guardar Preferencias
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
