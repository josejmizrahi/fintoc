"use client";

import { useState, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { usePayableInvoices, useReceivableInvoices, invoiceKeys } from "@/lib/hooks/use-invoices";
import { useInvoiceFilters } from "@/lib/hooks/use-url-state";
import { usePermission } from "@/lib/hooks/use-permission";
import { api } from "@/lib/api";
import type { Invoice } from "@/types";

import type { BulkValidationResult } from "./invoice-dialogs";

export function useFacturasState() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useInvoiceFilters();
  const canValidate = usePermission("invoices:validate");

  // Tab state
  const [activeTab, setActiveTab] = useState<"payable" | "receivable">("payable");

  // Build query filters
  const queryFilters = useMemo(
    () => ({
      search: filters.search || undefined,
      page: filters.page,
      per_page: filters.per_page,
      date_from: filters.date_from || undefined,
      date_to: filters.date_to || undefined,
      status: filters.status || undefined,
    }),
    [filters]
  );

  // Data queries
  const payableQuery = usePayableInvoices(queryFilters);
  const receivableQuery = useReceivableInvoices(queryFilters);

  const payableData: Invoice[] = Array.isArray(payableQuery.data) ? payableQuery.data : (payableQuery.data?.data ?? []);
  const receivableData: Invoice[] = Array.isArray(receivableQuery.data) ? receivableQuery.data : (receivableQuery.data?.data ?? []);

  const currentData = activeTab === "payable" ? payableData : receivableData;
  const _currentQuery = activeTab === "payable" ? payableQuery : receivableQuery;

  // Filter bar values
  const [filterBarValues, setFilterBarValues] = useState<Record<string, string>>({});

  // Local filtering based on FilterBar values (for filters not in URL state)
  const filteredData = useMemo(() => {
    let data = currentData;

    if (filterBarValues.sat_status) {
      data = data.filter((inv) => {
        if (filterBarValues.sat_status === "no_validado") {
          return !inv.sat_status && !inv.sat_validated;
        }
        return inv.sat_status?.toLowerCase() === filterBarValues.sat_status;
      });
    }

    if (filterBarValues.payment_state) {
      data = data.filter(
        (inv) => (inv.payment_state || "not_paid") === filterBarValues.payment_state
      );
    }

    if (filterBarValues.metodo_pago) {
      data = data.filter(
        (inv) =>
          (inv.metodo_pago || inv.payment_policy) === filterBarValues.metodo_pago
      );
    }

    if (filterBarValues.monto_min) {
      const min = parseFloat(filterBarValues.monto_min);
      if (!isNaN(min)) data = data.filter((inv) => (inv.amount_total ?? 0) >= min);
    }

    if (filterBarValues.monto_max) {
      const max = parseFloat(filterBarValues.monto_max);
      if (!isNaN(max)) data = data.filter((inv) => (inv.amount_total ?? 0) <= max);
    }

    if (filterBarValues.date_from) {
      data = data.filter((inv) => {
        const d = inv.date_invoice || inv.date_due;
        return d && d >= filterBarValues.date_from;
      });
    }

    if (filterBarValues.date_to) {
      data = data.filter((inv) => {
        const d = inv.date_invoice || inv.date_due;
        return d && d <= filterBarValues.date_to;
      });
    }

    return data;
  }, [currentData, filterBarValues]);

  // Count unvalidated invoices
  const unvalidatedCount = useMemo(() => {
    const all = [...payableData, ...receivableData];
    return all.filter((inv) => !inv.sat_status && !inv.sat_validated).length;
  }, [payableData, receivableData]);

  // Detail panel
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Dialog states
  const [xmlDialogOpen, setXmlDialogOpen] = useState(false);
  const [xmlInvoiceId, setXmlInvoiceId] = useState<string | null>(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelInvoice, setCancelInvoice] = useState<Invoice | null>(null);
  const [complementsDialogOpen, setComplementsDialogOpen] = useState(false);
  const [complementsInvoice, setComplementsInvoice] = useState<Invoice | null>(null);

  // Bulk validation
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);
  const [bulkTotal, setBulkTotal] = useState(0);
  const [bulkResults, setBulkResults] = useState<BulkValidationResult[]>([]);

  // Single invoice validation
  const handleValidateSingle = useCallback(
    async (invoice: Invoice) => {
      const uuid = invoice.cfdi_uuid || invoice.odoo_cfdi_uuid;
      if (!uuid) {
        toast.error("Esta factura no tiene UUID de CFDI");
        return;
      }
      try {
        const result = await api.sat.validate({ invoice_id: invoice.id, uuid });
        const newStatus = result.estado || result.sat_status || result.status;
        toast.success(`Validacion: ${newStatus || "completada"}`);
        queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
      } catch (err: unknown) {
        toast.error((err instanceof Error ? err.message : null) || "Error al validar en SAT");
      }
    },
    [queryClient]
  );

  // Bulk validation
  const handleBulkValidation = useCallback(async () => {
    const allInvoices = [...payableData, ...receivableData].filter(
      (inv) => inv.cfdi_uuid || inv.odoo_cfdi_uuid
    );

    if (allInvoices.length === 0) {
      toast.error("No hay facturas con UUID para validar");
      return;
    }

    setBulkResults([]);
    setBulkProgress(0);
    setBulkTotal(allInvoices.length);
    setBulkRunning(true);
    setBulkDialogOpen(true);

    const results: BulkValidationResult[] = [];

    for (let i = 0; i < allInvoices.length; i++) {
      const inv = allInvoices[i];
      const uuid = inv.cfdi_uuid || inv.odoo_cfdi_uuid || "";
      const previousStatus = inv.sat_status || "no_validado";

      try {
        const result = await api.sat.validate({ invoice_id: inv.id, uuid });
        const newStatus = result.estado || result.sat_status || result.status || "no_validado";
        results.push({
          uuid,
          invoiceName: inv.name,
          previousStatus,
          newStatus,
          changed: previousStatus !== newStatus,
          efosStatus: result.efos_status || inv.efos_status,
        });
      } catch {
        results.push({
          uuid,
          invoiceName: inv.name,
          previousStatus,
          newStatus: previousStatus,
          changed: false,
          efosStatus: inv.efos_status,
        });
      }

      setBulkProgress(i + 1);
    }

    setBulkResults(results);
    setBulkRunning(false);
    queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
  }, [payableData, receivableData, queryClient]);

  // Create payment (navigate to payments page with pre-filled data)
  const handleCreatePayment = useCallback((invoice: Invoice) => {
    const params = new URLSearchParams({
      invoice_id: String(invoice.id),
      partner_name: invoice.partner_name || "",
      partner_rfc: invoice.partner_rfc || "",
      amount: String(invoice.amount_residual ?? invoice.amount_total ?? 0),
      reference: invoice.name || "",
    });
    window.location.href = `/pagos/nuevo?${params.toString()}`;
  }, []);

  // Generate payment link
  const handlePaymentLink = useCallback(async (invoice: Invoice) => {
    try {
      const result = await api.collections.paymentLink({
        invoice_id: invoice.id,
        amount: invoice.amount_residual ?? invoice.amount_total ?? 0,
        description: `Pago factura ${invoice.name}`,
      });
      const link = result.url || result.link;
      if (link) {
        await navigator.clipboard.writeText(link);
        toast.success("Link de cobro copiado al portapapeles");
      } else {
        toast.success("Link de cobro generado");
      }
    } catch (err: unknown) {
      toast.error((err instanceof Error ? err.message : null) || "Error al generar link de cobro");
    }
  }, []);

  // Action handler
  const handleAction = useCallback(
    (action: string, invoice: Invoice) => {
      switch (action) {
        case "validate":
          handleValidateSingle(invoice);
          break;
        case "xml":
          setXmlInvoiceId(invoice.id);
          setXmlDialogOpen(true);
          break;
        case "create_payment":
          handleCreatePayment(invoice);
          break;
        case "payment_link":
          handlePaymentLink(invoice);
          break;
        case "complements":
          setComplementsInvoice(invoice);
          setComplementsDialogOpen(true);
          break;
        case "cancel":
          setCancelInvoice(invoice);
          setCancelDialogOpen(true);
          break;
      }
    },
    [handleValidateSingle, handleCreatePayment, handlePaymentLink]
  );

  // Row click -> detail panel
  const handleRowClick = useCallback((invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setDetailOpen(true);
  }, []);

  // Search handler
  const handleSearchChange = useCallback(
    (value: string) => {
      setFilters({ search: value, page: 1 });
    },
    [setFilters]
  );

  // Sync Odoo
  const handleSyncOdoo = useCallback(async () => {
    try {
      await api.sync.trigger("odoo");
      toast.success("Sincronizacion con Odoo iniciada");
      queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
    } catch (err: unknown) {
      toast.error((err instanceof Error ? err.message : null) || "Error al sincronizar");
    }
  }, [queryClient]);

  // Refresh handler
  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
  }, [queryClient]);

  // Empty state helpers
  const hasActiveFilters = Object.values(filterBarValues).some((v) => v !== "" && v != null);
  const hasDataButFilteredOut = (currentData.length > 0 && filteredData.length === 0) && hasActiveFilters;

  return {
    // State
    filters,
    setFilters,
    activeTab,
    setActiveTab,
    canValidate,
    filterBarValues,
    setFilterBarValues,

    // Data
    payableData,
    receivableData,
    filteredData,
    payableQuery,
    receivableQuery,
    unvalidatedCount,
    hasDataButFilteredOut,

    // Detail panel
    selectedInvoice,
    setSelectedInvoice,
    detailOpen,
    setDetailOpen,

    // Dialog states
    xmlDialogOpen,
    setXmlDialogOpen,
    xmlInvoiceId,
    setXmlInvoiceId,
    cancelDialogOpen,
    setCancelDialogOpen,
    cancelInvoice,
    complementsDialogOpen,
    setComplementsDialogOpen,
    complementsInvoice,

    // Bulk validation
    bulkDialogOpen,
    setBulkDialogOpen,
    bulkRunning,
    bulkProgress,
    bulkTotal,
    bulkResults,

    // Handlers
    handleAction,
    handleRowClick,
    handleSearchChange,
    handleBulkValidation,
    handleValidateSingle,
    handleSyncOdoo,
    handleRefresh,
  };
}
