"use client";

import { Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

import { api } from "@/lib/api";

const companySchema = z.object({
  name: z.string().min(1, "Nombre de empresa requerido"),
  rfc: z.string().min(12, "RFC invalido").max(13),
  address: z.string().optional(),
  phone: z.string().optional(),
});

type CompanyForm = z.infer<typeof companySchema>;

export function CompanyTab() {
  const form = useForm<CompanyForm>({
    resolver: zodResolver(companySchema),
    defaultValues: { name: "", rfc: "", address: "", phone: "" },
  });

  const saveMutation = useMutation({
    mutationFn: (data: CompanyForm) =>
      api.onboarding.save("general", {
        companyName: data.name,
        rfc: data.rfc,
        address: data.address || "",
        phone: data.phone || "",
      }),
    onSuccess: () => toast.success("Datos de empresa guardados"),
    onError: (err: Error) =>
      toast.error(err.message || "Error al guardar"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Datos de la Empresa</CardTitle>
        <CardDescription>
          Informacion general de tu empresa.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={form.handleSubmit((data) => saveMutation.mutate(data))}
          className="space-y-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="company-name">Nombre *</Label>
              <Input
                id="company-name"
                placeholder="Mi Empresa S.A. de C.V."
                {...form.register("name")}
              />
              {form.formState.errors.name && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.name.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="company-rfc">RFC *</Label>
              <Input
                id="company-rfc"
                placeholder="XAXX010101000"
                maxLength={13}
                {...form.register("rfc")}
              />
              {form.formState.errors.rfc && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.rfc.message}
                </p>
              )}
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="company-address">Direccion</Label>
              <Input
                id="company-address"
                placeholder="Calle, Colonia, Ciudad, CP"
                {...form.register("address")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="company-phone">Telefono</Label>
              <Input
                id="company-phone"
                placeholder="+52 55 1234 5678"
                {...form.register("phone")}
              />
            </div>
            <div className="space-y-2">
              <Label>Logo</Label>
              <Input type="file" accept="image/*" />
            </div>
          </div>
          <Separator />
          <div className="flex justify-end">
            <Button type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Guardar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
