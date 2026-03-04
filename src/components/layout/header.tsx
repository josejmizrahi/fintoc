"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Bell,
  LogOut,
  Menu,
  Moon,
  Settings,
  Sun,
  User,
  LayoutDashboard,
  CreditCard,
  Receipt,
  FileText,
  Users,
  UserCheck,
  Wallet,
  Landmark,
  PieChart,
  CheckCircle,
  Shield,
  GitCompare,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore, useSidebarStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";

const pageNames: Record<string, string> = {
  "/": "Dashboard",
  "/pagos": "Pagos",
  "/cobranza": "Cobranza",
  "/facturas": "Facturas",
  "/proveedores": "Proveedores",
  "/clientes": "Clientes",
  "/gastos": "Gastos",
  "/tesoreria": "Tesorería",
  "/presupuestos": "Presupuestos",
  "/aprobaciones": "Aprobaciones",
  "/sat": "SAT / CFDI",
  "/conciliacion": "Conciliación",
  "/reportes": "Reportes",
  "/configuracion": "Configuración",
};

const mobileNavItems = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Pagos", href: "/pagos", icon: CreditCard },
  { label: "Cobranza", href: "/cobranza", icon: Receipt },
  { label: "Facturas", href: "/facturas", icon: FileText },
  { label: "Proveedores", href: "/proveedores", icon: Users },
  { label: "Clientes", href: "/clientes", icon: UserCheck },
  { label: "Gastos", href: "/gastos", icon: Wallet },
  { label: "Tesorería", href: "/tesoreria", icon: Landmark },
  { label: "Presupuestos", href: "/presupuestos", icon: PieChart },
  { label: "Aprobaciones", href: "/aprobaciones", icon: CheckCircle },
  { label: "SAT / CFDI", href: "/sat", icon: Shield },
  { label: "Conciliación", href: "/conciliacion", icon: GitCompare },
  { label: "Reportes", href: "/reportes", icon: BarChart3 },
  { label: "Configuración", href: "/configuracion", icon: Settings },
];

function getPageName(pathname: string): string {
  if (pageNames[pathname]) return pageNames[pathname];

  // Match prefix for nested routes
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length > 0) {
    const basePath = "/" + segments[0];
    if (pageNames[basePath]) return pageNames[basePath];
  }

  return "Dashboard";
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuthStore();
  const { collapsed } = useSidebarStore();
  const pageName = getPageName(pathname);

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 md:px-6"
      )}
    >
      {/* Mobile menu trigger */}
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="md:hidden">
            <Menu className="size-5" />
            <span className="sr-only">Abrir menú</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
                P
              </div>
              Payana
            </SheetTitle>
          </SheetHeader>
          <nav className="flex flex-col gap-1 p-2">
            {mobileNavItems.map((item) => {
              const isActive =
                pathname === item.href ||
                pathname.startsWith(item.href + "/");
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    "hover:bg-accent hover:text-accent-foreground",
                    isActive &&
                      "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
                  )}
                >
                  <Icon
                    className={cn(
                      "size-4 shrink-0",
                      isActive && "text-primary"
                    )}
                  />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </SheetContent>
      </Sheet>

      {/* Breadcrumb / Page title */}
      <div className="flex-1">
        <h1 className="text-sm font-semibold md:text-base">{pageName}</h1>
      </div>

      {/* Right side actions */}
      <div className="flex items-center gap-2">
        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label="Cambiar tema"
        >
          <Sun className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </Button>

        {/* Notification bell */}
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="size-4" />
          <Badge
            variant="destructive"
            className="absolute -top-1 -right-1 size-4 items-center justify-center p-0 text-[10px]"
          >
            3
          </Badge>
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
              <Avatar>
                <AvatarFallback className="text-xs">
                  {user ? getInitials(user.name) : "U"}
                </AvatarFallback>
              </Avatar>
              <span className="hidden text-sm font-medium md:inline-block">
                {user?.name ?? "Usuario"}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium leading-none">
                  {user?.name ?? "Usuario"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {user?.email ?? "usuario@ejemplo.com"}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                onSelect={() => router.push("/configuracion")}
              >
                <User className="size-4" />
                Perfil
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => router.push("/configuracion")}
              >
                <Settings className="size-4" />
                Configuración
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleLogout} className="text-destructive">
              <LogOut className="size-4" />
              Cerrar sesión
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
