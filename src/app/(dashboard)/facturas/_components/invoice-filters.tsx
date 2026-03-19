"use client";

import {
  ShieldCheck,
  Loader2,
  RefreshCw,
} from "lucide-react";

import { SearchInput } from "@/components/shared/search-input";
import { PermissionGate } from "@/components/shared/permission-gate";
import { FilterBar, type FilterConfig } from "@/components/shared/filter-bar";

import { Button } from "@/components/ui/button";

/* ---------- Filter configuration ---------- */

export const INVOICE_FILTERS: FilterConfig[] = [
  {
    key: "date",
    label: "Fecha",
    type: "date-range",
  },
  {
    key: "sat_status",
    label: "Estado SAT",
    type: "select",
    options: [
      { value: "vigente", label: "Vigente" },
      { value: "cancelado", label: "Cancelado" },
      { value: "no_validado", label: "No validado" },
    ],
  },
  {
    key: "payment_state",
    label: "Estado Pago",
    type: "select",
    options: [
      { value: "paid", label: "Pagado" },
      { value: "partial", label: "Parcial" },
      { value: "not_paid", label: "No pagado" },
    ],
  },
  {
    key: "metodo_pago",
    label: "Metodo Pago",
    type: "select",
    options: [
      { value: "PUE", label: "PUE" },
      { value: "PPD", label: "PPD" },
    ],
  },
  {
    key: "monto_min",
    label: "Monto min",
    type: "text",
    placeholder: "0.00",
  },
  {
    key: "monto_max",
    label: "Monto max",
    type: "text",
    placeholder: "999,999.99",
  },
];

/* ---------- Toolbar Component ---------- */

export function InvoiceToolbar({
  searchValue,
  onSearchChange,
  onBulkValidation,
  bulkRunning,
  onRefresh,
  filterBarValues,
  onFilterBarChange,
}: {
  searchValue: string;
  onSearchChange: (value: string) => void;
  onBulkValidation: () => void;
  bulkRunning: boolean;
  onRefresh: () => void;
  filterBarValues: Record<string, string>;
  onFilterBarChange: (values: Record<string, string>) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={searchValue}
          onChange={onSearchChange}
          placeholder="Buscar por numero, proveedor, RFC, UUID..."
          className="w-full sm:w-80"
        />
        <PermissionGate permission="invoices.validate">
          <Button variant="outline" onClick={onBulkValidation} disabled={bulkRunning}>
            {bulkRunning ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <ShieldCheck className="mr-1.5 size-4" />
            )}
            Validar Todo
          </Button>
        </PermissionGate>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
        >
          <RefreshCw className="mr-1.5 size-4" />
          Actualizar
        </Button>
      </div>
      <FilterBar
        filters={INVOICE_FILTERS}
        values={filterBarValues}
        onChange={onFilterBarChange}
      />
    </div>
  );
}
