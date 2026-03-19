"use client";

import { Plus } from "lucide-react";

import { PermissionGate } from "@/components/shared/permission-gate";

import { Button } from "@/components/ui/button";

export function PageHeader({ onNewPayment }: { onNewPayment: () => void }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Pagos</h1>
        <p className="text-sm text-muted-foreground">
          Gestiona pagos a proveedores y transferencias SPEI.
        </p>
      </div>
      <PermissionGate permission="payments.create">
        <Button onClick={onNewPayment} className="sm:hidden">
          <Plus className="mr-2 size-4" />
          Nuevo Pago
        </Button>
      </PermissionGate>
    </div>
  );
}
