"use client";

import * as React from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export interface FilterConfig {
  key: string;
  label: string;
  type: "text" | "select" | "date" | "date-range";
  placeholder?: string;
  options?: { value: string; label: string }[];
}

interface FilterBarProps {
  filters: FilterConfig[];
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  className?: string;
}

export function FilterBar({
  filters,
  values,
  onChange,
  className,
}: FilterBarProps) {
  const handleChange = React.useCallback(
    (key: string, value: string) => {
      onChange({ ...values, [key]: value });
    },
    [values, onChange]
  );

  const handleClear = React.useCallback(() => {
    const cleared: Record<string, string> = {};
    filters.forEach((f) => {
      cleared[f.key] = "";
    });
    onChange(cleared);
  }, [filters, onChange]);

  const hasActiveFilters = Object.values(values).some((v) => v !== "");

  return (
    <div className={cn("flex flex-wrap items-end gap-3", className)}>
      {filters.map((filter) => (
        <div key={filter.key} className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">
            {filter.label}
          </Label>

          {filter.type === "select" && filter.options ? (
            <Select
              value={values[filter.key] || "__all__"}
              onValueChange={(val) => handleChange(filter.key, val === "__all__" ? "" : val)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue
                  placeholder={filter.placeholder ?? "Todos"}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos</SelectItem>
                {filter.options.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : filter.type === "date" ? (
            <Input
              type="date"
              value={values[filter.key] || ""}
              onChange={(e) => handleChange(filter.key, e.target.value)}
              className="w-[160px]"
            />
          ) : filter.type === "date-range" ? (
            <div className="flex items-center gap-1">
              <Input
                type="date"
                value={values[`${filter.key}_from`] || ""}
                onChange={(e) =>
                  handleChange(`${filter.key}_from`, e.target.value)
                }
                className="w-[140px]"
              />
              <span className="text-xs text-muted-foreground">-</span>
              <Input
                type="date"
                value={values[`${filter.key}_to`] || ""}
                onChange={(e) =>
                  handleChange(`${filter.key}_to`, e.target.value)
                }
                className="w-[140px]"
              />
            </div>
          ) : (
            <Input
              type="text"
              value={values[filter.key] || ""}
              onChange={(e) => handleChange(filter.key, e.target.value)}
              placeholder={filter.placeholder}
              className="w-[180px]"
            />
          )}
        </div>
      ))}

      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClear}
          className="gap-1 text-muted-foreground"
        >
          <X className="size-3" />
          Limpiar
        </Button>
      )}
    </div>
  );
}
