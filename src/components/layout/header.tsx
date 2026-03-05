'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  LogOut,
  Menu,
  Moon,
  RefreshCw,
  Search,
  Settings,
  Sun,
  User,
  Check,
  Plus,
  Building2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore, useSidebarStore, useSyncStore, useUIStore } from '@/lib/store';
import { api } from '@/lib/api';
import { useUnreadCount } from '@/lib/hooks/use-notifications';
import { formatRelative } from '@/lib/utils/format';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Sidebar } from './sidebar';

const pageNames: Record<string, string> = {
  '/': 'Dashboard',
  '/pagos': 'Pagos',
  '/cobranza': 'Cobranza',
  '/facturas': 'Facturas',
  '/proveedores': 'Proveedores',
  '/clientes': 'Clientes',
  '/gastos': 'Gastos',
  '/tesoreria': 'Tesoreria',
  '/presupuestos': 'Presupuestos',
  '/aprobaciones': 'Aprobaciones',
  '/sat': 'SAT',
  '/conciliacion': 'Conciliacion',
  '/reportes': 'Reportes',
  '/configuracion': 'Configuracion',
  '/onboarding': 'Configuracion Inicial',
};

function getPageName(pathname: string): string {
  if (pageNames[pathname]) return pageNames[pathname];
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length > 0) {
    const basePath = '/' + segments[0];
    if (pageNames[basePath]) return pageNames[basePath];
  }
  return 'Dashboard';
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();
  const { user, activeCompany, companies, role, logout, switchCompany } = useAuthStore();
  const { mobileOpen, setMobileOpen } = useSidebarStore();
  const { isSyncing, lastSync, setSync } = useSyncStore();
  const { setCommandPaletteOpen } = useUIStore();
  const { data: unreadCount } = useUnreadCount();
  const pageName = getPageName(pathname);

  const handleLogout = () => {
    logout();
    queryClient.clear();
    router.push('/login');
  };

  const handleSwitchCompany = async (company: typeof activeCompany) => {
    if (!company || company.id === activeCompany?.id) return;
    try {
      await api.auth.switchCompany({ company_id: company.id });
      switchCompany(company);
      queryClient.clear();
      if (!company.onboarding_completed) {
        router.push('/onboarding');
      } else {
        router.push('/');
      }
      toast.success(`Cambiado a ${company.name}`);
    } catch {
      toast.error('Error al cambiar de empresa');
    }
  };

  const handleSync = async () => {
    if (isSyncing) return;
    setSync({ isSyncing: true });
    try {
      await api.sync.trigger('all');
      setSync({ isSyncing: false, lastSync: new Date().toISOString() });
      queryClient.invalidateQueries();
      toast.success('Sincronizacion completada');
    } catch {
      setSync({ isSyncing: false });
      toast.error('Error en sincronizacion');
    }
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 md:px-6">
      {/* Mobile menu */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="md:hidden">
            <Menu className="size-5" />
            <span className="sr-only">Abrir menu</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
                Q
              </div>
              Quimibond
            </SheetTitle>
          </SheetHeader>
          <div className="py-2">
            <Sidebar />
          </div>
        </SheetContent>
      </Sheet>

      {/* Company switcher */}
      {companies.length > 1 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2 font-semibold">
              <Building2 className="size-4" />
              {activeCompany?.name || 'Empresa'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel>Empresas</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {companies.map((c) => (
              <DropdownMenuItem
                key={c.id}
                onSelect={() => handleSwitchCompany(c)}
                className="flex items-center justify-between"
              >
                <span>{c.name}</span>
                {c.id === activeCompany?.id && <Check className="size-4 text-primary" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => router.push('/configuracion')}>
              <Plus className="size-4" />
              Crear empresa
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className="text-sm font-semibold hidden md:block">{activeCompany?.name}</span>
      )}

      <div className="flex-1" />

      {/* Search trigger */}
      <Button
        variant="outline"
        size="sm"
        className="hidden md:flex gap-2 text-muted-foreground w-64"
        onClick={() => setCommandPaletteOpen(true)}
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Buscar...</span>
        <kbd className="pointer-events-none text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded">
          Ctrl+K
        </kbd>
      </Button>

      <div className="flex items-center gap-2">
        {/* Sync button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSync}
          disabled={isSyncing}
          className="gap-1.5 text-muted-foreground"
        >
          <RefreshCw className={cn('size-4', isSyncing && 'animate-spin')} />
          <span className="hidden lg:inline text-xs">
            {lastSync ? formatRelative(lastSync) : 'Sincronizar'}
          </span>
        </Button>

        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label="Cambiar tema"
        >
          <Sun className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </Button>

        {/* Notification bell */}
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="size-4" />
          {(unreadCount?.count ?? 0) > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 size-4 items-center justify-center p-0 text-[10px]"
            >
              {unreadCount?.count}
            </Badge>
          )}
          <span className="sr-only">Notificaciones</span>
        </Button>

        <Separator orientation="vertical" className="h-6" />

        {/* User dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="relative flex items-center gap-2 px-2"
            >
              <Avatar className="size-7">
                <AvatarFallback className="text-xs">
                  {user ? getInitials(user.name) : 'U'}
                </AvatarFallback>
              </Avatar>
              <div className="hidden md:flex flex-col items-start">
                <span className="text-sm font-medium leading-none">
                  {user?.name ?? 'Usuario'}
                </span>
                <span className="text-[10px] text-muted-foreground capitalize">{role}</span>
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium leading-none">
                  {user?.name ?? 'Usuario'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {user?.email ?? ''}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => router.push('/configuracion')}>
                <User className="size-4" />
                Perfil
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => router.push('/configuracion')}>
                <Settings className="size-4" />
                Configuracion
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleLogout} className="text-destructive">
              <LogOut className="size-4" />
              Cerrar sesion
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
