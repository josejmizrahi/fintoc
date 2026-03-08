"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function NewExtractionDialog({
  open,
  onClose,
  taxpayerId: _taxpayerId,
  defaultExtractor,
  onSubmit,
  isLoading,
}: {
  open: boolean;
  onClose: () => void;
  taxpayerId: string;
  defaultExtractor?: string;
  onSubmit: (extractor: string, options?: unknown) => void;
  isLoading: boolean;
}) {
  const [extractor, setExtractor] = useState(defaultExtractor || "invoice");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  function handleSubmit() {
    const options: Record<string, unknown> = {};
    if (dateFrom && dateTo) {
      options.period = { from: dateFrom, to: dateTo };
    }
    if (extractor === "invoice") {
      options.issued = true;
      options.received = true;
    }
    onSubmit(extractor, Object.keys(options).length > 0 ? options : undefined);
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva Extraction</DialogTitle>
          <DialogDescription>
            Crea un job para descargar datos del SAT via Syntage
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Tipo de extraction</Label>
            <Select value={extractor} onValueChange={setExtractor}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="invoice">Facturas CFDI</SelectItem>
                <SelectItem value="annual_tax_return">Declaracion Anual</SelectItem>
                <SelectItem value="monthly_tax_return">Declaracion Mensual</SelectItem>
                <SelectItem value="tax_status">Constancia Fiscal</SelectItem>
                <SelectItem value="tax_compliance">Opinion Cumplimiento</SelectItem>
                <SelectItem value="tax_retention">Retenciones</SelectItem>
                <SelectItem value="electronic_accounting">Contabilidad Electronica</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {extractor === "invoice" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Desde</Label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Hasta</Label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={isLoading}>
            {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Crear Extraction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
