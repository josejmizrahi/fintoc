"use client";

import { useState, useRef, useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";

import { Vendor, Invoice } from "@/types";
import { useCreatePayment } from "@/lib/hooks/use-payments";
import { api } from "@/lib/api";
import { createPaymentSchema } from "@/lib/utils/validation";
import { formatMoney } from "@/lib/utils/format";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { type PaymentFormValues } from "./types";

export function CreatePaymentDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createPayment = useCreatePayment();
  const form = useForm<PaymentFormValues>({
    resolver: zodResolver(createPaymentSchema),
    defaultValues: {
      vendor_name: "",
      concept: "",
      clabe: "",
      amount: 0,
      reference: "",
      scheduled_date: "",
    },
  });

  // Vendor combobox state
  const [vendorSearch, setVendorSearch] = useState("");
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [showVendorDropdown, setShowVendorDropdown] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const vendorDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Invoice state
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);

  // Concept counter
  // eslint-disable-next-line react-hooks/incompatible-library -- form.watch is required for live character count
  const conceptValue = form.watch("concept");
  const conceptLen = conceptValue?.length || 0;

  // Debounced vendor search
  useEffect(() => {
    if (!open) return;
    if (vendorDebounce.current) clearTimeout(vendorDebounce.current);
    vendorDebounce.current = setTimeout(() => {
      api.vendors
        .list({ search: vendorSearch })
        .then((v) => setVendors(Array.isArray(v) ? v : []))
        .catch(() => setVendors([]));
    }, 300);
    return () => {
      if (vendorDebounce.current) clearTimeout(vendorDebounce.current);
    };
  }, [vendorSearch, open]);

  // Load vendor invoices
  useEffect(() => {
    if (!selectedVendor) {
      setInvoices([]);
      return;
    }
    setLoadingInvoices(true);
    api.invoices
      .payable({ partner_name: selectedVendor.name })
      .then((inv) => setInvoices(Array.isArray(inv) ? inv : []))
      .catch(() => setInvoices([]))
      .finally(() => setLoadingInvoices(false));
  }, [selectedVendor]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowVendorDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function selectVendor(v: Vendor) {
    setSelectedVendor(v);
    setVendorSearch(v.name || "");
    setShowVendorDropdown(false);
    form.setValue("vendor_name", v.name || "");
    form.setValue("vendor_id", v.id);
    if (v.clabe) {
      form.setValue("clabe", v.clabe);
    }
  }

  function selectInvoice(inv: Invoice) {
    form.setValue("invoice_id", inv.id);
    if (inv.amount_residual) {
      form.setValue("amount", inv.amount_residual);
    }
  }

  function resetDialog() {
    form.reset();
    setVendorSearch("");
    setSelectedVendor(null);
    setVendors([]);
    setInvoices([]);
    setShowVendorDropdown(false);
  }

  async function onSubmit(data: PaymentFormValues) {
    await createPayment.mutateAsync({
      vendor_id: data.vendor_id,
      invoice_id: data.invoice_id || undefined,
      amount: data.amount,
      concept: data.concept,
      reference: data.reference || undefined,
      scheduled_date: data.scheduled_date || undefined,
    });
    resetDialog();
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        if (!val) resetDialog();
        onOpenChange(val);
      }}
    >
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo Pago</DialogTitle>
          <DialogDescription>
            Ingresa los datos para realizar un pago a proveedor via SPEI.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 py-2">
          {/* Vendor combobox */}
          <div className="grid gap-2 relative" ref={dropdownRef}>
            <Label>Proveedor *</Label>
            <Input
              placeholder="Buscar proveedor por nombre o RFC..."
              value={vendorSearch}
              onChange={(e) => {
                setVendorSearch(e.target.value);
                setSelectedVendor(null);
                form.setValue("vendor_name", e.target.value);
                form.setValue("vendor_id", "");
                setShowVendorDropdown(true);
              }}
              onFocus={() => setShowVendorDropdown(true)}
              autoComplete="off"
            />
            {form.formState.errors.vendor_name && (
              <p className="text-xs text-destructive">
                {form.formState.errors.vendor_name.message}
              </p>
            )}
            {showVendorDropdown && vendors.length > 0 && (
              <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-48 overflow-y-auto rounded-md border bg-popover shadow-md">
                {vendors.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-accent text-left"
                    onClick={() => selectVendor(v)}
                  >
                    <div>
                      <span className="font-medium">{v.name}</span>
                      {v.rfc && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {v.rfc}
                        </span>
                      )}
                    </div>
                    {v.clabe && (
                      <span className="text-xs text-muted-foreground font-mono">
                        ****{v.clabe.slice(-4)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Invoice select (optional) */}
          {selectedVendor && (
            <div className="grid gap-2">
              <Label>Factura (opcional)</Label>
              {loadingInvoices ? (
                <Skeleton className="h-9 w-full" />
              ) : invoices.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Sin facturas por pagar para este proveedor.
                </p>
              ) : (
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  defaultValue=""
                  onChange={(e) => {
                    const inv = invoices.find(
                      (i) => i.id === e.target.value
                    );
                    if (inv) selectInvoice(inv);
                  }}
                >
                  <option value="">Seleccionar factura...</option>
                  {invoices.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.name} - {formatMoney(inv.amount_residual || 0)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Amount */}
          <div className="grid gap-2">
            <Label>Monto (MXN) *</Label>
            <Controller
              control={form.control}
              name="amount"
              render={({ field }) => (
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  value={field.value || ""}
                  onChange={(e) =>
                    field.onChange(
                      e.target.value ? parseFloat(e.target.value) : 0
                    )
                  }
                />
              )}
            />
            {form.formState.errors.amount && (
              <p className="text-xs text-destructive">
                {form.formState.errors.amount.message}
              </p>
            )}
          </div>

          {/* CLABE */}
          <div className="grid gap-2">
            <Label>CLABE destino *</Label>
            <Controller
              control={form.control}
              name="clabe"
              render={({ field }) => (
                <Input
                  placeholder="18 digitos"
                  maxLength={18}
                  value={field.value}
                  onChange={(e) =>
                    field.onChange(
                      e.target.value.replace(/\D/g, "").slice(0, 18)
                    )
                  }
                  className="font-mono tracking-wider"
                />
              )}
            />
            {selectedVendor?.clabe &&
              form.getValues("clabe") === selectedVendor.clabe && (
                <p className="text-xs text-muted-foreground">
                  Auto-llenado del proveedor seleccionado
                </p>
              )}
            {form.formState.errors.clabe && (
              <p className="text-xs text-destructive">
                {form.formState.errors.clabe.message}
              </p>
            )}
          </div>

          {/* Concepto */}
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>Concepto *</Label>
              <span
                className={`text-xs ${
                  conceptLen > 40
                    ? "text-destructive"
                    : "text-muted-foreground"
                }`}
              >
                {conceptLen}/40
              </span>
            </div>
            <Input
              placeholder="Concepto del pago (max 40 caracteres SPEI)"
              maxLength={40}
              {...form.register("concept")}
            />
            {form.formState.errors.concept && (
              <p className="text-xs text-destructive">
                {form.formState.errors.concept.message}
              </p>
            )}
          </div>

          {/* Reference */}
          <div className="grid gap-2">
            <Label>Referencia numerica (opcional)</Label>
            <Controller
              control={form.control}
              name="reference"
              render={({ field }) => (
                <Input
                  placeholder="Max 7 digitos"
                  maxLength={7}
                  value={field.value || ""}
                  onChange={(e) =>
                    field.onChange(
                      e.target.value.replace(/\D/g, "").slice(0, 7)
                    )
                  }
                  className="font-mono"
                />
              )}
            />
            {form.formState.errors.reference && (
              <p className="text-xs text-destructive">
                {form.formState.errors.reference.message}
              </p>
            )}
          </div>

          {/* Scheduled date */}
          <div className="grid gap-2">
            <Label>Fecha programada (opcional)</Label>
            <Input type="date" {...form.register("scheduled_date")} />
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                resetDialog();
                onOpenChange(false);
              }}
              disabled={createPayment.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={createPayment.isPending}>
              {createPayment.isPending && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Crear Pago
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
