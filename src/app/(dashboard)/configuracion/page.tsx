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

export default function ConfiguracionPage() {
  return (
    <PermissionGate
      permission="config:read"
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

        <Tabs defaultValue="empresa" orientation="vertical" className="flex gap-6">
          <TabsList className="flex flex-col h-auto w-[200px] shrink-0">
            <TabsTrigger value="empresa" className="w-full justify-start">
              <Building2 className="size-4 mr-2" />
              Empresa
            </TabsTrigger>
            <TabsTrigger value="usuarios" className="w-full justify-start">
              <Users className="size-4 mr-2" />
              Usuarios y Roles
            </TabsTrigger>
            <TabsTrigger value="integraciones" className="w-full justify-start">
              <Link2 className="size-4 mr-2" />
              Integraciones
            </TabsTrigger>
            <TabsTrigger value="preferencias" className="w-full justify-start">
              <Settings className="size-4 mr-2" />
              Preferencias
            </TabsTrigger>
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
    </PermissionGate>
  );
}
