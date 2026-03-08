"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/* ---------- Period Selector component ---------- */

export function PeriodSelector({
  preset,
  onPresetChange,
  customStart,
  customEnd,
  onCustomStartChange,
  onCustomEndChange,
}: {
  preset: string;
  onPresetChange: (value: string) => void;
  customStart: string;
  customEnd: string;
  onCustomStartChange: (value: string) => void;
  onCustomEndChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="grid gap-1.5">
        <Label className="text-xs">Periodo</Label>
        <Select value={preset} onValueChange={onPresetChange}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Seleccionar periodo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="current_month">Mes actual</SelectItem>
            <SelectItem value="previous_month">Mes anterior</SelectItem>
            <SelectItem value="quarter">Ultimo trimestre</SelectItem>
            <SelectItem value="semester">Ultimo semestre</SelectItem>
            <SelectItem value="custom">Personalizado</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {preset === "custom" && (
        <>
          <div className="grid gap-1.5">
            <Label className="text-xs">Desde</Label>
            <Input
              type="date"
              value={customStart}
              onChange={(e) => onCustomStartChange(e.target.value)}
              className="w-[160px]"
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Hasta</Label>
            <Input
              type="date"
              value={customEnd}
              onChange={(e) => onCustomEndChange(e.target.value)}
              className="w-[160px]"
            />
          </div>
        </>
      )}
    </div>
  );
}
