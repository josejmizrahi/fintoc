'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  LayoutDashboard,
  CreditCard,
  Receipt,
  FileText,
  Building2,
  Users,
  Wallet,
  Landmark,
  PieChart,
  ShieldCheck,
  ScrollText,
  GitCompare,
  RefreshCw,
  BarChart3,
  Settings,
  Check,
  ChevronsUpDown,
  Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore, useSidebarStore } from '@/lib/store';
import { SIDEBAR_VISIBILITY, type Role } from '@/lib/rbac';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

const navItems = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard },
  { label: 'Pagos', href: '/pagos', icon: CreditCard },
  { label: 'Cobranza', href: '/cobranza', icon: Receipt },
  { label: 'Facturas', href: '/facturas', icon: FileText },
  { label: 'Proveedores', href: '/proveedores', icon: Building2 },
  { label: 'Clientes', href: '/clientes', icon: Users },
  { label: 'Gastos', href: '/gastos', icon: Wallet },
  { label: 'Tesoreria', href: '/tesoreria', icon: Landmark },
  { label: 'Presupuestos', href: '/presupuestos', icon: PieChart },
  { label: 'Aprobaciones', href: '/aprobaciones', icon: ShieldCheck },
  { label: 'SAT', href: '/sat', icon: ScrollText },
  { label: 'Sincronizacion', href: '/sincronizacion', icon: RefreshCw },
  { label: 'Conciliacion', href: '/conciliacion', icon: GitCompare },
  { label: 'Reportes', href: '/reportes', icon: BarChart3 },
  { label: 'Configuracion', href: '/configuracion', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { collapsed } = useSidebarStore();
  const { role, companies, activeCompany, switchCompany } = useAuthStore();

  const visibleItems = navItems.filter((item) => {
    const allowedRoles = SIDEBAR_VISIBILITY[item.href];
    return !allowedRoles || allowedRoles.includes(role as Role);
  });

  const handleSwitchCompany = async (company: typeof activeCompany) => {
    if (!company || company.id === activeCompany?.id) return;
    try {
      const res = await api.auth.switchCompany({ company_id: company.id });
      const newRole = res?.data?.active_company?.role || 'admin';
      switchCompany(company, newRole);
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

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 flex h-screen flex-col border-r bg-card transition-all duration-300',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      <div className="flex h-14 items-center border-b px-4">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
            Q
          </div>
          {!collapsed && (
            <span className="text-lg font-semibold tracking-tight">
              Quimibond
            </span>
          )}
        </Link>
      </div>

      <ScrollArea className="flex-1 px-2 py-2">
        <TooltipProvider delayDuration={0}>
          <nav className="flex flex-col gap-1">
            {visibleItems.map((item) => {
              const isActive =
                item.href === '/'
                  ? pathname === '/'
                  : pathname === item.href ||
                    pathname.startsWith(item.href + '/');
              const Icon = item.icon;

              const linkContent = (
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    'hover:bg-accent hover:text-accent-foreground',
                    isActive &&
                      'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
                    collapsed && 'justify-center px-2',
                  )}
                >
                  <Icon
                    className={cn(
                      'size-4 shrink-0',
                      isActive && 'text-primary',
                    )}
                  />
                  {!collapsed && <span>{item.label}</span>}
                </Link>
              );

              if (collapsed) {
                return (
                  <Tooltip key={item.href}>
                    <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>
                      {item.label}
                    </TooltipContent>
                  </Tooltip>
                );
              }

              return <div key={item.href}>{linkContent}</div>;
            })}
          </nav>
        </TooltipProvider>
      </ScrollArea>

      <Separator />

      {/* Company switcher */}
      <div className="p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className={cn(
                'w-full gap-2 h-auto py-2',
                collapsed ? 'justify-center px-2' : 'justify-between px-3',
              )}
            >
              <div className="flex items-center gap-2 truncate">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Building2 className="size-4" />
                </div>
                {!collapsed && (
                  <div className="flex flex-col items-start truncate">
                    <span className="truncate text-sm font-medium">
                      {activeCompany?.name || 'Empresa'}
                    </span>
                    {activeCompany?.rfc && (
                      <span className="truncate text-[10px] text-muted-foreground">
                        {activeCompany.rfc}
                      </span>
                    )}
                  </div>
                )}
              </div>
              {!collapsed && <ChevronsUpDown className="size-4 shrink-0 opacity-50" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuLabel>Empresa activa</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => router.push('/configuracion')}>
              <Settings className="size-4" />
              Perfil de empresa
            </DropdownMenuItem>
            {companies.length > 1 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-muted-foreground">Cambiar empresa</DropdownMenuLabel>
                {companies.map((c) => (
                  <DropdownMenuItem
                    key={c.id}
                    onSelect={() => handleSwitchCompany(c)}
                    className="flex items-center justify-between"
                  >
                    <span className="truncate">{c.name}</span>
                    {c.id === activeCompany?.id && <Check className="size-4 text-primary shrink-0" />}
                  </DropdownMenuItem>
                ))}
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => router.push('/configuracion')}>
              <Plus className="size-4" />
              Crear nueva empresa
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
