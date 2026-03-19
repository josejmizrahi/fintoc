"use client";

import { Play } from "lucide-react";

import { Payment } from "@/types";
import { formatMoney } from "@/lib/utils/format";

import { PermissionGate } from "@/components/shared/permission-gate";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

export function BatchExecutionBar({
  selectedPayments,
  onExecute,
  isExecuting,
  batchProgress,
  batchTotal,
}: {
  selectedPayments: Payment[];
  onExecute: () => void;
  isExecuting: boolean;
  batchProgress: number;
  batchTotal: number;
}) {
  const total = selectedPayments.reduce((sum, p) => sum + p.amount, 0);

  if (selectedPayments.length === 0) return null;

  return (
    <div className="flex items-center gap-4 rounded-lg border bg-muted/50 px-4 py-3">
      <Badge variant="secondary">
        {selectedPayments.length} pagos seleccionados
      </Badge>
      <span className="text-sm font-medium">
        Total: {formatMoney(total)}
      </span>

      {isExecuting ? (
        <div className="flex items-center gap-3 ml-auto min-w-[200px]">
          <Progress
            value={batchTotal > 0 ? (batchProgress / batchTotal) * 100 : 0}
            className="flex-1"
          />
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            Procesando {batchProgress}/{batchTotal}...
          </span>
        </div>
      ) : (
        <PermissionGate permission="payments.execute">
          <Button size="sm" className="ml-auto" onClick={onExecute}>
            <Play className="mr-2 size-4" />
            Ejecutar Seleccionados
          </Button>
        </PermissionGate>
      )}
    </div>
  );
}
