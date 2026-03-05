'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
  BarChart3,
  Settings,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore, useSidebarStore } from '@/lib/store';
import { SIDEBAR_VISIBILITY, type Role } from '@/lib/rbac';
import { Button } from '@/components/ui/button';
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
  { label: 'Conciliacion', href: '/conciliacion', icon: GitCompare },
  { label: 'Reportes', href: '/reportes', icon: BarChart3 },
  { label: 'Configuracion', href: '/configuracion', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { collapsed, toggle } = useSidebarStore();
  const role = useAuthStore((s) => s.role);

  const visibleItems = navItems.filter((item) => {
    const allowedRoles = SIDEBAR_VISIBILITY[item.href];
    return !allowedRoles || allowedRoles.includes(role as Role);
  });

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

      <div className="flex items-center justify-center p-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          aria-label={collapsed ? 'Expandir menu' : 'Colapsar menu'}
        >
          {collapsed ? (
            <ChevronsRight className="size-4" />
          ) : (
            <ChevronsLeft className="size-4" />
          )}
        </Button>
      </div>
    </aside>
  );
}
