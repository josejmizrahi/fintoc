"use client";

import { Loader2, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatDateTime } from "@/lib/utils/format";

/* ---------- Processing overlay ---------- */

export function ProcessingOverlay({
  progressPercent,
  currentLabel,
}: {
  progressPercent: number;
  currentLabel: string;
}) {
  return (
    <Card>
      <CardContent className="py-8">
        <div className="mx-auto max-w-md space-y-4">
          <div className="flex items-center justify-center gap-2 text-sm font-medium">
            <Loader2 className="size-4 animate-spin" />
            {currentLabel}
          </div>
          <Progress value={progressPercent} className="h-3" />
          <p className="text-center text-xs text-muted-foreground">
            {Math.round(progressPercent)}% completado
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- All Reconciled Banner ---------- */

export function AllReconciledBanner({ lastRun }: { lastRun?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950/30">
      <CheckCircle2 className="size-5 text-green-600 shrink-0" />
      <div>
        <p className="font-medium text-green-800 dark:text-green-300">
          Todo conciliado. 0 discrepancias.
        </p>
        {lastRun && (
          <p className="text-sm text-green-600 dark:text-green-400">
            Ultima ejecucion: {formatDateTime(lastRun)}
          </p>
        )}
      </div>
    </div>
  );
}
