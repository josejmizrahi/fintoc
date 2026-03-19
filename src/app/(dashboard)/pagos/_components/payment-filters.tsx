"use client";

import { Plus } from "lucide-react";

import { SearchInput } from "@/components/shared/search-input";
import { PermissionGate } from "@/components/shared/permission-gate";
import { FilterBar, type FilterConfig } from "@/components/shared/filter-bar";

import { Button } from "@/components/ui/button";

export const FILTER_CONFIGS: FilterConfig[] = [
  {
    key: "date",
    label: "Fecha",
    type: "date-range",
  },
];

export function PaymentToolbar({
  search,
  onSearchChange,
  filterValues,
  onFilterChange,
  onNewPayment,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  filterValues: Record<string, string>;
  onFilterChange: (values: Record<string, string>) => void;
  onNewPayment: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-2">
        <PermissionGate permission="payments.create">
          <Button onClick={onNewPayment}>
            <Plus className="mr-2 size-4" />
            Nuevo Pago
          </Button>
        </PermissionGate>
      </div>

      <div className="flex items-center gap-3 flex-1 justify-center">
        <SearchInput
          value={search}
          onChange={onSearchChange}
          placeholder="Buscar por proveedor, referencia..."
          className="w-full max-w-sm"
        />
      </div>

      <FilterBar
        filters={FILTER_CONFIGS}
        values={filterValues}
        onChange={onFilterChange}
      />
    </div>
  );
}
