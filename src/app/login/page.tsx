"use client";

import { useState, useEffect } from "react";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

export default function LoginPage() {
  const router = useRouter();
  const loginWithToken = useAuthStore((s) => s.loginWithToken);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Redirect to dashboard if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      router.replace("/");
    }
  }, [isAuthenticated, router]);

  // Login state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  // Register state
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regName, setRegName] = useState("");
  const [regCompanyName, setRegCompanyName] = useState("");
  const [regRfc, setRegRfc] = useState("");
  const [regLoading, setRegLoading] = useState(false);

  // Demo
  const [demoLoading, setDemoLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!loginEmail.trim() || !loginPassword.trim()) {
      toast.error("Ingresa tu correo y contraseña");
      return;
    }
    setLoginLoading(true);
    try {
      const res = await api.auth.login({
        email: loginEmail.trim(),
        password: loginPassword,
      });
      loginWithToken(res.access_token, res.user, res.tenant);
      toast.success("Sesión iniciada correctamente");
      router.push("/");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Error al iniciar sesión"
      );
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (
      !regEmail.trim() ||
      !regPassword.trim() ||
      !regName.trim() ||
      !regCompanyName.trim() ||
      !regRfc.trim()
    ) {
      toast.error("Completa todos los campos");
      return;
    }
    if (regPassword.length < 8) {
      toast.error("La contraseña debe tener al menos 8 caracteres");
      return;
    }
    setRegLoading(true);
    try {
      const res = await api.auth.register({
        email: regEmail.trim(),
        password: regPassword,
        name: regName.trim(),
        company_name: regCompanyName.trim(),
        rfc: regRfc.trim().toUpperCase(),
      });
      loginWithToken(res.access_token, res.user, res.tenant);
      toast.success(`Empresa ${regCompanyName} registrada correctamente`);
      router.push("/onboarding");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Error al registrar"
      );
    } finally {
      setRegLoading(false);
    }
  }

  async function handleQuickStart() {
    setDemoLoading(true);
    try {
      // Generate unique demo account per session
      const uid = crypto.randomUUID().slice(0, 8);
      const demoEmail = `demo-${uid}@payana.demo`;
      const demoPassword = crypto.randomUUID();
      const res = await api.auth.register({
        email: demoEmail,
        password: demoPassword,
        name: "Admin Demo",
        company_name: `Demo Corp ${uid}`,
        rfc: `XAXX010101${uid.slice(0, 3).toUpperCase()}`,
      });
      loginWithToken(res.access_token, res.user, res.tenant);
      toast.success("Empresa demo creada. Bienvenido a Payana.");
      router.push("/");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Error al crear empresa demo"
      );
    } finally {
      setDemoLoading(false);
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
            <CardTitle>Bienvenido</CardTitle>
            <CardDescription>
              Inicia sesión o crea una cuenta para comenzar.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="login" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">Iniciar sesión</TabsTrigger>
                <TabsTrigger value="register">Registrarse</TabsTrigger>
              </TabsList>

              {/* Login Tab */}
              <TabsContent value="login">
                <form onSubmit={handleLogin} className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label htmlFor="login-email">Correo electrónico</Label>
                    <Input
                      id="login-email"
                      type="email"
                      placeholder="tu@empresa.com"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      autoComplete="email"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password">Contraseña</Label>
                    <Input
                      id="login-password"
                      type="password"
                      placeholder="••••••••"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      autoComplete="current-password"
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={loginLoading}>
                    {loginLoading ? "Iniciando sesión..." : "Iniciar sesión"}
                  </Button>
                </form>
              </TabsContent>

              {/* Register Tab */}
              <TabsContent value="register">
                <form onSubmit={handleRegister} className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label htmlFor="reg-name">Nombre completo</Label>
                    <Input
                      id="reg-name"
                      placeholder="Juan Pérez"
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-email">Correo electrónico</Label>
                    <Input
                      id="reg-email"
                      type="email"
                      placeholder="tu@empresa.com"
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      autoComplete="email"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-password">Contraseña</Label>
                    <Input
                      id="reg-password"
                      type="password"
                      placeholder="Mínimo 8 caracteres"
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      autoComplete="new-password"
                    />
                  </div>

                  <Separator />

                  <div className="space-y-1">
                    <p className="text-sm font-medium">Datos de la empresa</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="reg-company">Nombre de la empresa</Label>
                    <Input
                      id="reg-company"
                      placeholder="Mi Empresa SA de CV"
                      value={regCompanyName}
                      onChange={(e) => setRegCompanyName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-rfc">RFC</Label>
                    <Input
                      id="reg-rfc"
                      placeholder="XAXX010101000"
                      value={regRfc}
                      onChange={(e) => setRegRfc(e.target.value.toUpperCase())}
                      maxLength={13}
                    />
                  </div>

                  <Button type="submit" className="w-full" disabled={regLoading}>
                    {regLoading ? "Registrando..." : "Crear cuenta"}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>

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
              disabled={demoLoading}
            >
              {demoLoading
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
