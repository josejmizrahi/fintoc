"use client";

import { useState } from "react";
import { PermissionGate } from "@/components/shared/permission-gate";
import { ShieldAlert, ShieldCheck, FileSearch, Landmark } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { SatOdooTab } from "./_components/sat-odoo-tab";
import { SatAppTab } from "./_components/sat-app-tab";
import { BancoAppTab } from "./_components/banco-app-tab";
import { ReconciliationHistory } from "./_components/reconciliation-history";

/* ========== MAIN PAGE ========== */

export default function ConciliacionPage() {
  const [activeTab, setActiveTab] = useState("sat-odoo");

  return (
    <PermissionGate
      permission="reconciliation.read"
      fallback={
        <div className="flex flex-col items-center justify-center gap-4 py-24 text-muted-foreground">
          <ShieldAlert className="size-12" />
          <p className="text-lg font-medium">Acceso restringido</p>
          <p className="text-sm">No tienes permisos para ver conciliacion.</p>
        </div>
      }
    >
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Conciliacion</h1>
        <p className="text-sm text-muted-foreground">
          Concilia registros entre SAT, Odoo, la aplicacion y el banco para detectar discrepancias.
        </p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="sat-odoo" className="gap-1.5">
            <ShieldCheck className="size-4" />
            SAT - Odoo
          </TabsTrigger>
          <TabsTrigger value="sat-app" className="gap-1.5">
            <FileSearch className="size-4" />
            SAT - App
          </TabsTrigger>
          <TabsTrigger value="banco-app" className="gap-1.5">
            <Landmark className="size-4" />
            Banco - App
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sat-odoo" className="space-y-6">
          <SatOdooTab />
        </TabsContent>

        <TabsContent value="sat-app" className="space-y-6">
          <SatAppTab />
        </TabsContent>

        <TabsContent value="banco-app" className="space-y-6">
          <BancoAppTab />
        </TabsContent>
      </Tabs>

      {/* History Section */}
      <ReconciliationHistory />
    </div>
    </PermissionGate>
  );
}
