"use client";

import * as React from "react";
import { Building2, Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { useAuthStore } from "@/lib/store";
import { api } from "@/lib/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export function CompanySwitcher() {
  const queryClient = useQueryClient();
  const { companies, activeCompany, switchCompany } = useAuthStore();
  const [isLoading, setIsLoading] = React.useState(false);

  const handleSwitch = React.useCallback(
    async (company: (typeof companies)[number]) => {
      if (company.id === activeCompany?.id) return;

      setIsLoading(true);
      try {
        const res = await api.auth.switchCompany({ company_id: company.id });
        switchCompany(company, res.role);
        queryClient.clear();
      } catch {
        // Error handled by api layer (toast / redirect)
      } finally {
        setIsLoading(false);
      }
    },
    [activeCompany?.id, switchCompany, queryClient]
  );

  if (companies.length <= 1) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 text-sm">
        <Building2 className="size-4 text-muted-foreground" />
        <span className="truncate font-medium">
          {activeCompany?.name ?? "Sin empresa"}
        </span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-between gap-2"
          disabled={isLoading}
        >
          <div className="flex items-center gap-2 truncate">
            <Building2 className="size-4 shrink-0" />
            <span className="truncate">
              {activeCompany?.name ?? "Seleccionar empresa"}
            </span>
          </div>
          {isLoading ? (
            <Loader2 className="size-4 shrink-0 animate-spin" />
          ) : (
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[240px]">
        <DropdownMenuLabel>Empresas</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {companies.map((company) => {
          const isActive = company.id === activeCompany?.id;
          return (
            <DropdownMenuItem
              key={company.id}
              onClick={() => handleSwitch(company)}
              className={cn("gap-2", isActive && "font-medium")}
            >
              <Check
                className={cn(
                  "size-4 shrink-0",
                  isActive ? "opacity-100" : "opacity-0"
                )}
              />
              <div className="flex flex-col truncate">
                <span className="truncate">{company.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {company.rfc}
                </span>
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
