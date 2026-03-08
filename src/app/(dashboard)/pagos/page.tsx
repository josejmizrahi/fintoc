"use client";

import { useState, useCallback, useMemo } from "react";
import {
  CreditCard,
  AlertCircle,
  RefreshCw,
} from "lucide-react";

import { Payment } from "@/types";
import {
  usePayments,
  useExecutePayment,
  useExecuteBatchPayments,
  useCancelPayment,
  useRetryPayment,
} from "@/lib/hooks/use-payments";
import { usePaymentFilters } from "@/lib/hooks/use-url-state";
import { usePermission } from "@/lib/hooks/use-permission";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/utils/format";

import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

import { type TabKey, TAB_STATUS_MAP } from "./_components/types";
import { getColumns } from "./_components/columns";
import { CreatePaymentDialog } from "./_components/create-payment-dialog";
import { PaymentDetailPanel } from "./_components/payment-detail-panel";
import { BatchExecutionBar } from "./_components/batch-actions";
import { PaymentToolbar } from "./_components/payment-filters";
import { PageHeader } from "./_components/page-header";

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function PagosPage() {
  // URL state
  const [filters, setFilters] = usePaymentFilters();

  // Local UI state
  const [activeTab, setActiveTab] = useState<TabKey>("todos");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Payment[]>([]);

  // Confirm dialogs
  const [executeConfirm, setExecuteConfirm] = useState<Payment | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState<Payment | null>(null);
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);

  // Batch execution progress
  const [batchExecuting, setBatchExecuting] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);

  // Permissions
  const canCreate = usePermission("payments:create");
  const canExecute = usePermission("payments:execute");
  const canCancel = usePermission("payments:cancel");

  // Build query filters
  const queryFilters = useMemo(() => {
    const f: Record<string, unknown> = {};
    const statusFromTab = TAB_STATUS_MAP[activeTab];
    if (statusFromTab) f.status = statusFromTab;
    if (filters.search) f.search = filters.search;
    if (filters.date_from) f.date_from = filters.date_from;
    if (filters.date_to) f.date_to = filters.date_to;
    f.page = filters.page;
    f.per_page = filters.per_page;
    return f;
  }, [activeTab, filters]);

  // Data fetching
  const {
    data: paymentsResponse,
    isLoading,
    isError,
    error,
    refetch,
  } = usePayments(queryFilters);

  const payments: Payment[] = useMemo(() => {
    if (!paymentsResponse) return [];
    if (Array.isArray(paymentsResponse)) return paymentsResponse;
    if (paymentsResponse.data) return paymentsResponse.data;
    if ((paymentsResponse as unknown as Record<string, unknown>).items) return (paymentsResponse as unknown as Record<string, unknown>).items as Payment[];
    return [];
  }, [paymentsResponse]);

  const totalCount = useMemo(() => {
    if (!paymentsResponse) return 0;
    if (Array.isArray(paymentsResponse)) return paymentsResponse.length;
    return paymentsResponse.meta?.total ?? (paymentsResponse as unknown as Record<string, number>).total ?? (paymentsResponse as unknown as Record<string, number>).count ?? payments.length;
  }, [paymentsResponse, payments.length]);

  // Mutations
  const executePayment = useExecutePayment();
  const executeBatch = useExecuteBatchPayments();
  const cancelPayment = useCancelPayment();
  const retryPayment = useRetryPayment();

  // Handlers
  const handleRowAction = useCallback(
    (action: string, payment: Payment) => {
      switch (action) {
        case "view":
          setSelectedPayment(payment);
          setDetailOpen(true);
          break;
        case "execute":
          setExecuteConfirm(payment);
          break;
        case "cancel":
          setCancelConfirm(payment);
          break;
        case "retry":
          retryPayment.mutate(payment.id);
          break;
      }
    },
    [retryPayment]
  );

  // Column definitions
  const columns = useMemo(
    () =>
      getColumns({
        onRowAction: handleRowAction,
        canExecute,
        canCancel,
      }),
    [handleRowAction, canExecute, canCancel]
  );

  function handleRowClick(payment: Payment) {
    setSelectedPayment(payment);
    setDetailOpen(true);
  }

  async function handleConfirmExecute() {
    if (!executeConfirm) return;
    await executePayment.mutateAsync(executeConfirm.id);
    setExecuteConfirm(null);
  }

  async function handleConfirmCancel() {
    if (!cancelConfirm) return;
    await cancelPayment.mutateAsync(cancelConfirm.id);
    setCancelConfirm(null);
  }

  async function handleBatchExecute() {
    setBatchConfirmOpen(false);
    const ids = selectedRows.map((p) => p.id);
    setBatchTotal(ids.length);
    setBatchProgress(0);
    setBatchExecuting(true);

    try {
      // Try batch endpoint first
      await executeBatch.mutateAsync(ids);
      setBatchProgress(ids.length);
    } catch {
      // Fallback: execute one by one for progress tracking
      for (let i = 0; i < ids.length; i++) {
        try {
          await api.payments.execute({ payment_id: ids[i] });
        } catch {
          // continue with rest
        }
        setBatchProgress(i + 1);
      }
    } finally {
      setBatchExecuting(false);
      setBatchProgress(0);
      setBatchTotal(0);
      setSelectedRows([]);
      refetch();
    }
  }

  const handleSearchChange = useCallback(
    (value: string) => {
      setFilters({ search: value, page: 1 });
    },
    [setFilters]
  );

  const handleFilterChange = useCallback(
    (values: Record<string, string>) => {
      setFilters({
        date_from: values.date_from || "",
        date_to: values.date_to || "",
        page: 1,
      });
    },
    [setFilters]
  );

  const handleTabChange = useCallback(
    (tab: string) => {
      setActiveTab(tab as TabKey);
      setFilters({ page: 1 });
      setSelectedRows([]);
    },
    [setFilters]
  );

  const handlePaginationChange = useCallback(
    (pagination: { page: number; pageSize: number; total: number }) => {
      setFilters({ page: pagination.page });
    },
    [setFilters]
  );

  // Pending payments for batch selection
  const showBatchBar =
    activeTab === "pendientes" || activeTab === "todos";

  const pendingSelected = selectedRows.filter(
    (p) => p.status === "pending" || p.status === "pending_approval"
  );

  // Toolbar
  const toolbar = (
    <PaymentToolbar
      search={filters.search}
      onSearchChange={handleSearchChange}
      filterValues={{
        date_from: filters.date_from,
        date_to: filters.date_to,
      }}
      onFilterChange={handleFilterChange}
      onNewPayment={() => setDialogOpen(true)}
    />
  );

  // Empty state
  const emptyState = (
    <EmptyState
      icon={CreditCard}
      title="No hay pagos"
      description="Crea tu primer pago a proveedor para empezar a gestionar tus transferencias SPEI."
      action={
        canCreate
          ? {
              label: "Nuevo Pago",
              onClick: () => setDialogOpen(true),
            }
          : undefined
      }
    />
  );

  // Error state
  if (isError) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader onNewPayment={() => setDialogOpen(true)} />
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="rounded-full bg-destructive/10 p-4">
            <AlertCircle className="size-8 text-destructive" />
          </div>
          <h3 className="mt-4 text-lg font-semibold">Error al cargar pagos</h3>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {(error as Error)?.message || "Ocurrio un error inesperado."}
          </p>
          <Button className="mt-4" variant="outline" onClick={() => refetch()}>
            <RefreshCw className="mr-2 size-4" />
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader onNewPayment={() => setDialogOpen(true)} />

      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
      >
        <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
          <TabsList>
            <TabsTrigger value="todos">Todos</TabsTrigger>
            <TabsTrigger value="pendientes">Pendientes</TabsTrigger>
            <TabsTrigger value="ejecutados">Ejecutados</TabsTrigger>
            <TabsTrigger value="programados">Programados</TabsTrigger>
            <TabsTrigger value="fallidos">Fallidos</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value={activeTab} className="mt-4">
          {/* Batch execution bar */}
          {showBatchBar && (
            <BatchExecutionBar
              selectedPayments={pendingSelected}
              onExecute={() => setBatchConfirmOpen(true)}
              isExecuting={batchExecuting}
              batchProgress={batchProgress}
              batchTotal={batchTotal}
            />
          )}

          <DataTable
            columns={columns}
            data={payments}
            isLoading={isLoading}
            selectable={showBatchBar}
            onSelectionChange={setSelectedRows}
            onRowClick={handleRowClick}
            emptyState={emptyState}
            toolbar={toolbar}
            pagination={{
              page: filters.page,
              pageSize: filters.per_page,
              total: totalCount,
            }}
            onPaginationChange={handlePaginationChange}
          />
        </TabsContent>
      </Tabs>

      {/* Detail Panel */}
      <PaymentDetailPanel
        payment={selectedPayment}
        isOpen={detailOpen}
        onClose={() => {
          setDetailOpen(false);
          setSelectedPayment(null);
        }}
      />

      {/* New Payment Dialog */}
      <CreatePaymentDialog open={dialogOpen} onOpenChange={setDialogOpen} />

      {/* Execute Confirm Dialog */}
      <ConfirmDialog
        open={!!executeConfirm}
        onOpenChange={(open) => !open && setExecuteConfirm(null)}
        title="Confirmar ejecucion de pago"
        description={
          executeConfirm
            ? `Confirmas enviar ${formatMoney(executeConfirm.amount)} a ${executeConfirm.partner_name || "proveedor"} via SPEI? Esta accion no se puede deshacer.`
            : ""
        }
        confirmLabel="Ejecutar Pago"
        onConfirm={handleConfirmExecute}
        loading={executePayment.isPending}
      />

      {/* Cancel Confirm Dialog */}
      <ConfirmDialog
        open={!!cancelConfirm}
        onOpenChange={(open) => !open && setCancelConfirm(null)}
        title="Cancelar pago"
        description={
          cancelConfirm
            ? `Estas seguro de cancelar el pago de ${formatMoney(cancelConfirm.amount)} a ${cancelConfirm.partner_name || "proveedor"}?`
            : ""
        }
        confirmLabel="Cancelar Pago"
        variant="destructive"
        onConfirm={handleConfirmCancel}
        loading={cancelPayment.isPending}
      />

      {/* Batch Execute Confirm Dialog */}
      <ConfirmDialog
        open={batchConfirmOpen}
        onOpenChange={setBatchConfirmOpen}
        title="Ejecutar pagos seleccionados"
        description={`Confirmas ejecutar ${pendingSelected.length} pagos por un total de ${formatMoney(
          pendingSelected.reduce((s, p) => s + p.amount, 0)
        )} via SPEI? Esta accion no se puede deshacer.`}
        confirmLabel={`Ejecutar ${pendingSelected.length} pagos`}
        onConfirm={handleBatchExecute}
        loading={batchExecuting}
      />
    </div>
  );
}
