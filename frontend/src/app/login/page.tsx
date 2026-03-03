"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export default function LoginPage() {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [rfc, setRfc] = useState("");
  const [loading, setLoading] = useState(false);
  const [quickStartLoading, setQuickStartLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!companyName.trim() || !rfc.trim()) {
      toast.error("Ingresa el nombre de la empresa y RFC");
      return;
    }

    if (!email.trim()) {
      toast.error("Ingresa tu correo electrónico");
      return;
    }

    setLoading(true);
    try {
      const company = await api.companies.create({
        name: companyName.trim(),
        rfc: rfc.trim().toUpperCase(),
      });

      login(email, company.id?.toString() || company.tenant_id || rfc, companyName);
      toast.success(`Empresa ${companyName} registrada correctamente`);
      router.push("/");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Error al registrar la empresa. Intenta de nuevo."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleQuickStart() {
    setQuickStartLoading(true);
    try {
      const demoName = "Demo Corp SA de CV";
      const demoRfc = "DCO230101AAA";
      const demoEmail = "admin@demo.com";

      const company = await api.companies.create({
        name: demoName,
        rfc: demoRfc,
      });

      login(demoEmail, company.id?.toString() || company.tenant_id || demoRfc, demoName);
      toast.success("Empresa demo creada. Bienvenido a Payana.");
      router.push("/");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Error al crear empresa demo. Intenta de nuevo."
      );
    } finally {
      setQuickStartLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-md space-y-6">
        {/* Branding */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Payana</h1>
          <p className="text-muted-foreground">
            Plataforma de pagos y cobranza para empresas en México
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Iniciar sesión</CardTitle>
            <CardDescription>
              Ingresa tus datos para acceder a tu cuenta o registra una nueva
              empresa.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* User credentials */}
              <div className="space-y-2">
                <Label htmlFor="email">Correo electrónico</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="tu@empresa.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Contraseña</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>

              <Separator />

              {/* Company info */}
              <div className="space-y-1">
                <p className="text-sm font-medium">Datos de la empresa</p>
                <p className="text-xs text-muted-foreground">
                  Registra tu empresa para comenzar a usar Payana.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="companyName">Nombre de la empresa</Label>
                <Input
                  id="companyName"
                  placeholder="Mi Empresa SA de CV"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="rfc">RFC</Label>
                <Input
                  id="rfc"
                  placeholder="XAXX010101000"
                  value={rfc}
                  onChange={(e) => setRfc(e.target.value.toUpperCase())}
                  maxLength={13}
                />
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Registrando..." : "Entrar"}
              </Button>
            </form>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <Separator />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">
                  o bien
                </span>
              </div>
            </div>

            <Button
              variant="outline"
              className="w-full"
              onClick={handleQuickStart}
              disabled={quickStartLoading}
            >
              {quickStartLoading
                ? "Creando demo..."
                : "Inicio rápido con empresa demo"}
            </Button>

            <p className="mt-4 text-center text-xs text-muted-foreground">
              Al continuar, aceptas los términos de servicio y la política de
              privacidad de Payana.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
