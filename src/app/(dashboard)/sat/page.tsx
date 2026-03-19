"use client";

import { useState } from "react";
import { PermissionGate } from "@/components/shared/permission-gate";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ScrollText,
  ShieldAlert,
} from "lucide-react";

import { api } from "@/lib/api";

import { EmptyState } from "@/components/shared/empty-state";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { satKeys } from "./_components/helpers";
import { InvoicesTab } from "./_components/invoices-tab";
import { ExtractionsTab } from "./_components/extractions-tab";
import { TaxStatusTab } from "./_components/tax-status-tab";
import { RetentionsTab } from "./_components/retentions-tab";
import { TaxReturnsTab } from "./_components/tax-returns-tab";
import type { SyntageTaxpayer } from "./_components/types";

/* ------------------------------------------------------------------ */
/* Main Page                                                           */
/* ------------------------------------------------------------------ */

export default function SatPage() {
  const [activeTab, setActiveTab] = useState("facturas");
  const _queryClient = useQueryClient();

  // ── Connection status ──
  const statusQuery = useQuery({
    queryKey: satKeys.status(),
    queryFn: () => api.sat.syntage.status(),
    staleTime: 60_000,
    retry: false,
  });

  // ── Taxpayers ── (el backend solo devuelve entidades cuyo RFC coincide con el de la empresa)
  const taxpayersQuery = useQuery({
    queryKey: satKeys.taxpayers(),
    queryFn: () => api.sat.syntage.taxpayers(),
    staleTime: 60_000,
    enabled: statusQuery.data?.ok === true,
  });

  const taxpayers: SyntageTaxpayer[] = taxpayersQuery.data?.taxpayers || [];
  // Preferir la entidad vinculada a la empresa (syntage_taxpayer_id) para no mezclar datos
  const linkedTaxpayerId = (statusQuery.data as { syntage_taxpayer_id?: string })?.syntage_taxpayer_id;
  const [selectedTaxpayer, setSelectedTaxpayer] = useState<string>(linkedTaxpayerId || "");
  const activeTaxpayer = selectedTaxpayer || linkedTaxpayerId || taxpayers[0]?.id || "";

  const permFallback = (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-muted-foreground">
      <ShieldAlert className="size-12" />
      <p className="text-lg font-medium">Acceso restringido</p>
      <p className="text-sm">No tienes permisos para ver SAT.</p>
    </div>
  );

  // Not connected? Show setup prompt
  if (statusQuery.isSuccess && !statusQuery.data?.ok) {
    return (
      <PermissionGate permission="invoices.read" fallback={permFallback}>
      <div className="space-y-6 p-6">
        <h1 className="text-2xl font-bold">SAT via Syntage</h1>
        <EmptyState
          icon={ScrollText}
          title="SAT no configurado"
          description="Para acceder a tus facturas CFDI, declaraciones y situacion fiscal necesitas una cuenta de Syntage (syntage.com). Configura tu API Key y sube tu FIEL (.cer y .key) en la seccion de integraciones."
          action={{ label: "Configurar integracion SAT", onClick: () => window.location.href = "/configuracion" }}
        />
      </div>
      </PermissionGate>
    );
  }

  const companyRfc = (statusQuery.data as { company_rfc?: string })?.company_rfc;
  const noMatchingEntity = statusQuery.data?.ok && taxpayers.length === 0 && taxpayersQuery.isSuccess;

  return (
    <PermissionGate permission="invoices.read" fallback={permFallback}>
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">SAT via Syntage</h1>
          <p className="text-sm text-muted-foreground">
            Gestion fiscal completa: facturas, declaraciones, cumplimiento y retenciones
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Selector de entidad: solo las que coinciden con el RFC de la empresa */}
          {noMatchingEntity && (
            <p className="text-sm text-amber-600">
              No hay ninguna entidad en Syntage con el RFC de esta empresa{companyRfc ? ` (${companyRfc})` : ""}. Vincula una credencial con ese RFC en Syntage o revisa Configuracion.
            </p>
          )}
          {taxpayers.length > 1 && (
            <Select value={activeTaxpayer} onValueChange={setSelectedTaxpayer}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Contribuyente" />
              </SelectTrigger>
              <SelectContent>
                {taxpayers.map((tp) => (
                  <SelectItem key={tp.id} value={tp.id}>
                    {tp.name || tp.rfc}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {taxpayers.length === 1 && (
            <Badge variant="outline" className="text-sm">
              RFC: {taxpayers[0].rfc}
            </Badge>
          )}
          {statusQuery.data?.ok && (
            <Badge className="bg-green-100 text-green-800">Syntage conectado</Badge>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="facturas">Facturas CFDI</TabsTrigger>
          <TabsTrigger value="extractions">Extracciones</TabsTrigger>
          <TabsTrigger value="status">Situacion Fiscal</TabsTrigger>
          <TabsTrigger value="retenciones">Retenciones</TabsTrigger>
          <TabsTrigger value="declaraciones">Declaraciones</TabsTrigger>
        </TabsList>

        <TabsContent value="facturas" className="space-y-4">
          <InvoicesTab taxpayerId={activeTaxpayer} />
        </TabsContent>

        <TabsContent value="extractions" className="space-y-4">
          <ExtractionsTab taxpayerId={activeTaxpayer} />
        </TabsContent>

        <TabsContent value="status" className="space-y-4">
          <TaxStatusTab taxpayerId={activeTaxpayer} />
        </TabsContent>

        <TabsContent value="retenciones" className="space-y-4">
          <RetentionsTab taxpayerId={activeTaxpayer} />
        </TabsContent>

        <TabsContent value="declaraciones" className="space-y-4">
          <TaxReturnsTab taxpayerId={activeTaxpayer} />
        </TabsContent>
      </Tabs>
    </div>
    </PermissionGate>
  );
}
