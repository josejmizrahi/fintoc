"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Building2,
  Loader2,
  RefreshCw,
  Shield,
} from "lucide-react";

import { api } from "@/lib/api";
import { formatDate } from "@/lib/utils/format";

import { EmptyState } from "@/components/shared/empty-state";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

import { satKeys, complianceBadge } from "./helpers";

export function TaxStatusTab({ taxpayerId }: { taxpayerId: string }) {
  const queryClient = useQueryClient();

  const taxStatusQuery = useQuery({
    queryKey: satKeys.taxStatus(taxpayerId),
    queryFn: () => api.sat.syntage.taxStatus(taxpayerId),
    enabled: !!taxpayerId,
    staleTime: 60_000,
  });

  const complianceQuery = useQuery({
    queryKey: satKeys.taxCompliance(taxpayerId),
    queryFn: () => api.sat.syntage.taxCompliance(taxpayerId),
    enabled: !!taxpayerId,
    staleTime: 60_000,
  });

  const extractMutation = useMutation({
    mutationFn: (extractor: string) => api.sat.syntage.extract(taxpayerId, extractor),
    onSuccess: () => {
      toast.success("Actualizacion solicitada. Se procesara en Syntage.");
      queryClient.invalidateQueries({ queryKey: satKeys.extractions() });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const statuses = taxStatusQuery.data?.statuses || [];
  const latestStatus = statuses[0] as Record<string, unknown> | undefined;
  const checks = complianceQuery.data?.checks || [];
  const latestCheck = checks[0] as Record<string, unknown> | undefined;

  return (
    <div className="space-y-6">
      {/* Constancia de Situacion Fiscal */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Constancia de Situacion Fiscal</CardTitle>
              <CardDescription>Datos del contribuyente extraidos del SAT</CardDescription>
            </div>
            <Button
              variant="outline"
              onClick={() => extractMutation.mutate("tax_status")}
              disabled={extractMutation.isPending}
            >
              {extractMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Actualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {taxStatusQuery.isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-6 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : latestStatus ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">RFC</p>
                <p className="font-medium font-mono">{String(latestStatus.rfc || "-")}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Razon Social</p>
                <p className="font-medium">{String(latestStatus.name || "-")}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Status</p>
                <p className="font-medium">{String(latestStatus.status || "-")}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Regimen Fiscal</p>
                <p>{String(latestStatus.fiscalRegime || "-")}</p>
              </div>
              {latestStatus.createdAt != null && (
                <div>
                  <p className="text-muted-foreground">Fecha consulta</p>
                  <p>{formatDate(latestStatus.createdAt as string)}</p>
                </div>
              )}
            </div>
          ) : (
            <EmptyState
              icon={Building2}
              title="Sin datos fiscales"
              description="Solicita una extraction de tipo 'Constancia Fiscal' para obtener los datos."
              action={{ label: "Solicitar", onClick: () => extractMutation.mutate("tax_status") }}
            />
          )}
        </CardContent>
      </Card>

      {/* Opinion de Cumplimiento */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Opinion de Cumplimiento</CardTitle>
              <CardDescription>Resultado de la verificacion de cumplimiento fiscal ante el SAT</CardDescription>
            </div>
            <Button
              variant="outline"
              onClick={() => extractMutation.mutate("tax_compliance")}
              disabled={extractMutation.isPending}
            >
              {extractMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Actualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {complianceQuery.isLoading ? (
            <div className="h-12 bg-muted animate-pulse rounded" />
          ) : latestCheck ? (
            <div className="flex items-center gap-6">
              <div>
                <p className="text-muted-foreground text-sm">Resultado</p>
                {complianceBadge(String(latestCheck.result || ""))}
              </div>
              {latestCheck.validFrom != null && (
                <div>
                  <p className="text-muted-foreground text-sm">Vigencia</p>
                  <p className="text-sm">
                    {formatDate(latestCheck.validFrom as string)}
                    {latestCheck.validTo != null && ` - ${formatDate(latestCheck.validTo as string)}`}
                  </p>
                </div>
              )}
              {latestCheck.createdAt != null && (
                <div>
                  <p className="text-muted-foreground text-sm">Fecha consulta</p>
                  <p className="text-sm">{formatDate(latestCheck.createdAt as string)}</p>
                </div>
              )}
            </div>
          ) : (
            <EmptyState
              icon={Shield}
              title="Sin opinion de cumplimiento"
              description="Solicita una verificacion para conocer tu estado fiscal."
              action={{ label: "Verificar", onClick: () => extractMutation.mutate("tax_compliance") }}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
