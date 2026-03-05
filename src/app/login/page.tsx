'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Loader2, Eye, EyeOff, CreditCard, Shield, BarChart3, GitCompare } from 'lucide-react';
import { z } from 'zod';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { loginSchema, registerSchema, resetPasswordSchema } from '@/lib/utils/validation';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';

type LoginValues = z.infer<typeof loginSchema>;
type RegisterValues = z.infer<typeof registerSchema>;
type ResetValues = z.infer<typeof resetPasswordSchema>;

type View = 'auth' | 'reset' | 'new-password';

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const loginWithToken = useAuthStore((s) => s.loginWithToken);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [mounted, setMounted] = useState(false);
  const [view, setView] = useState<View>(searchParams.get('reset') === 'true' ? 'new-password' : 'auth');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Show debug info if user was redirected from a 401
    const authDebug = sessionStorage.getItem('auth_debug');
    if (authDebug) {
      sessionStorage.removeItem('auth_debug');
      toast.error(`Sesion cerrada: ${authDebug}`, { duration: 10000 });
    }
  }, []);

  useEffect(() => {
    if (mounted && isAuthenticated) {
      router.replace('/');
    }
  }, [mounted, isAuthenticated, router]);

  // Login form
  const loginForm = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  // Register form
  const registerForm = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      company_name: '',
      rfc: '',
      email: '',
      password: '',
      confirm_password: '',
    },
  });

  // Reset form
  const resetForm = useForm<ResetValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { email: '' },
  });

  async function onLogin(data: LoginValues) {
    try {
      const res = await api.auth.login(data);
      if (!res.access_token) {
        toast.error('Login exitoso pero no se recibio token');
        return;
      }
      const user = { id: res.user.id, email: res.user.email, name: res.user.full_name || res.user.name || '' };
      loginWithToken(
        res.access_token,
        user,
        { id: res.tenant?.id || res.company?.id, name: res.tenant?.name || res.company?.name, rfc: res.tenant?.rfc || res.company?.rfc },
        res.role || 'admin',
      );
      // Verify the full auth chain works before navigating
      try {
        const debugRes = await api.auth.debug();
        if (debugRes.error) {
          toast.error(`Auth check fallo: ${debugRes.error}`, { duration: 10000 });
          return;
        }
      } catch (verifyErr) {
        toast.error(`Token no valido: ${verifyErr instanceof Error ? verifyErr.message : 'Error desconocido'}`, { duration: 10000 });
        return;
      }
      toast.success('Sesion iniciada correctamente');
      if (res.onboarding_completed === false) {
        router.push('/onboarding');
      } else {
        router.push('/');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Credenciales invalidas');
    }
  }

  async function onRegister(data: RegisterValues) {
    try {
      const payload: Parameters<typeof api.auth.register>[0] = {
        email: data.email,
        password: data.password,
        company_name: data.company_name,
        rfc: data.rfc,
      };
      if ('full_name' in data && data.full_name) {
        payload.full_name = data.full_name;
      }
      const res = await api.auth.register(payload);
      if (!res.access_token) {
        // Registration succeeded but session creation failed — ask user to log in
        toast.success('Cuenta creada. Inicia sesion con tus credenciales.');
        return;
      }
      const user = { id: res.user.id, email: res.user.email, name: res.user.full_name || res.user.name || '' };
      loginWithToken(
        res.access_token,
        user,
        { id: res.tenant?.id || res.company?.id, name: res.tenant?.name || res.company?.name, rfc: data.rfc },
        'admin',
      );
      toast.success('Cuenta creada. Configura tus integraciones.');
      router.push('/onboarding');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al registrar');
    }
  }

  async function onReset(data: ResetValues) {
    try {
      await api.auth.resetPassword(data);
      toast.success('Si el email existe, recibiras un link de recuperacion');
      setView('auth');
    } catch {
      toast.success('Si el email existe, recibiras un link de recuperacion');
      setView('auth');
    }
  }

  if (view === 'reset') {
    return (
      <div className="flex min-h-screen">
        <BrandingPanel />
        <div className="flex flex-1 items-center justify-center px-4 py-12">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Recuperar contrasena</CardTitle>
              <CardDescription>
                Ingresa tu email para recibir un link de recuperacion.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...resetForm}>
                <form onSubmit={resetForm.handleSubmit(onReset)} className="space-y-4">
                  <FormField
                    control={resetForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input placeholder="tu@empresa.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full" disabled={resetForm.formState.isSubmitting}>
                    {resetForm.formState.isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
                    Enviar link de recuperacion
                  </Button>
                </form>
              </Form>
            </CardContent>
            <CardFooter>
              <Button variant="link" className="w-full" onClick={() => setView('auth')}>
                Volver a iniciar sesion
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <BrandingPanel />
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Bienvenido</CardTitle>
            <CardDescription>
              Inicia sesion o crea una cuenta para comenzar.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="login" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">Iniciar sesion</TabsTrigger>
                <TabsTrigger value="register">Registrarse</TabsTrigger>
              </TabsList>

              {/* Login Tab */}
              <TabsContent value="login">
                <Form {...loginForm}>
                  <form onSubmit={loginForm.handleSubmit(onLogin)} className="space-y-4 pt-2">
                    <FormField
                      control={loginForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl>
                            <Input placeholder="tu@empresa.com" autoComplete="email" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={loginForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Contrasena</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Input
                                type={showPassword ? 'text' : 'password'}
                                placeholder="••••••••"
                                autoComplete="current-password"
                                {...field}
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="absolute right-0 top-0 h-full px-3"
                                onClick={() => setShowPassword(!showPassword)}
                              >
                                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                              </Button>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="link"
                        className="px-0 text-sm"
                        onClick={() => setView('reset')}
                      >
                        Olvidaste tu contrasena?
                      </Button>
                    </div>
                    <Button type="submit" className="w-full" disabled={loginForm.formState.isSubmitting}>
                      {loginForm.formState.isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
                      Iniciar sesion
                    </Button>
                  </form>
                </Form>
              </TabsContent>

              {/* Register Tab */}
              <TabsContent value="register">
                <Form {...registerForm}>
                  <form onSubmit={registerForm.handleSubmit(onRegister)} className="space-y-4 pt-2">
                    <FormField
                      control={registerForm.control}
                      name="company_name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nombre de la empresa</FormLabel>
                          <FormControl>
                            <Input placeholder="Mi Empresa SA de CV" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={registerForm.control}
                      name="rfc"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>RFC</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="XAXX010101000"
                              maxLength={13}
                              {...field}
                              onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={registerForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl>
                            <Input placeholder="tu@empresa.com" autoComplete="email" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={registerForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Contrasena</FormLabel>
                          <FormControl>
                            <Input
                              type="password"
                              placeholder="Min 8 chars, 1 mayuscula, 1 numero"
                              autoComplete="new-password"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={registerForm.control}
                      name="confirm_password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Confirmar contrasena</FormLabel>
                          <FormControl>
                            <Input
                              type="password"
                              placeholder="Repite tu contrasena"
                              autoComplete="new-password"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button type="submit" className="w-full" disabled={registerForm.formState.isSubmitting}>
                      {registerForm.formState.isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
                      Crear cuenta
                    </Button>
                  </form>
                </Form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function BrandingPanel() {
  return (
    <div className="hidden lg:flex lg:w-1/2 bg-primary text-primary-foreground flex-col justify-center px-12 py-16">
      <div className="max-w-md">
        <div className="flex items-center gap-3 mb-8">
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary-foreground/20 font-bold text-xl">
            Q
          </div>
          <span className="text-3xl font-bold">Quimibond</span>
        </div>
        <h2 className="text-2xl font-semibold mb-4">
          Plataforma financiera para empresas en Mexico
        </h2>
        <p className="text-primary-foreground/80 mb-8">
          Gestiona pagos SPEI, facturas CFDI, cobranza y conciliacion fiscal en un solo lugar.
        </p>
        <div className="space-y-4">
          <Feature icon={CreditCard} text="Pagos SPEI instantaneos via Fintoc" />
          <Feature icon={Shield} text="Validacion CFDI y compliance SAT" />
          <Feature icon={GitCompare} text="Conciliacion automatica SAT-Odoo" />
          <Feature icon={BarChart3} text="Reportes financieros en tiempo real" />
        </div>
      </div>
    </div>
  );
}

function Feature({ icon: Icon, text }: { icon: any; text: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-8 items-center justify-center rounded-lg bg-primary-foreground/20">
        <Icon className="size-4" />
      </div>
      <span className="text-sm">{text}</span>
    </div>
  );
}
