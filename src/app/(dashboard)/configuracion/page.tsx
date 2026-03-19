"use client";

import { Building2, Users, Link2, Settings } from "lucide-react";

import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { EmptyState } from "@/components/shared/empty-state";
import { PermissionGate } from "@/components/shared/permission-gate";

import { CompanyTab } from "./_components/company-tab";
import { UsersTab } from "./_components/users-tab";
import { IntegrationsTab } from "./_components/integrations-tab";
import { PreferencesTab } from "./_components/preferences-tab";

const TABS = [
  { value: "empresa", label: "Empresa", icon: Building2 },
  { value: "usuarios", label: "Usuarios", icon: Users },
  { value: "integraciones", label: "Integraciones", icon: Link2 },
  { value: "preferencias", label: "Preferencias", icon: Settings },
] as const;

export default function ConfiguracionPage() {
  return (
    <PermissionGate
      permission="config.read"
      fallback={
        <EmptyState
          icon={Settings}
          title="Acceso restringido"
          description="Solo administradores pueden acceder a la configuracion."
        />
      }
    >
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Configuracion</h1>
          <p className="text-muted-foreground text-sm">
            Administra tu empresa, usuarios, integraciones y preferencias.
          </p>
        </div>

        {/* Mobile: horizontal scrollable tabs */}
        <div className="block md:hidden">
          <Tabs defaultValue="empresa">
            <TabsList className="w-full justify-start overflow-x-auto">
              {TABS.map(({ value, label, icon: Icon }) => (
                <TabsTrigger key={value} value={value} className="gap-1.5">
                  <Icon className="size-4" />
                  <span className="text-xs">{label}</span>
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="empresa" className="mt-4">
              <CompanyTab />
            </TabsContent>
            <TabsContent value="usuarios" className="mt-4">
              <UsersTab />
            </TabsContent>
            <TabsContent value="integraciones" className="mt-4">
              <IntegrationsTab />
            </TabsContent>
            <TabsContent value="preferencias" className="mt-4">
              <PreferencesTab />
            </TabsContent>
          </Tabs>
        </div>

        {/* Desktop: vertical sidebar tabs */}
        <div className="hidden md:block">
          <Tabs
            defaultValue="empresa"
            orientation="vertical"
            className="flex gap-6"
          >
            <TabsList
              variant="line"
              className="flex flex-col h-auto w-[220px] shrink-0 sticky top-20"
            >
              {TABS.map(({ value, label, icon: Icon }) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="w-full justify-start gap-2 px-3 py-2"
                >
                  <Icon className="size-4" />
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>

            <div className="flex-1 min-w-0">
              <TabsContent value="empresa" className="mt-0">
                <CompanyTab />
              </TabsContent>
              <TabsContent value="usuarios" className="mt-0">
                <UsersTab />
              </TabsContent>
              <TabsContent value="integraciones" className="mt-0">
                <IntegrationsTab />
              </TabsContent>
              <TabsContent value="preferencias" className="mt-0">
                <PreferencesTab />
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </PermissionGate>
  );
}
