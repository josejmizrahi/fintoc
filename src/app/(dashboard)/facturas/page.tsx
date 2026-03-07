"use client";

import {
  FileText,
  ShieldCheck,
  AlertTriangle,
  Loader2,
} from "lucide-react";

import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { DetailPanel } from "@/components/shared/detail-panel";
import { PermissionGate } from "@/components/shared/permission-gate";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { useInvoiceColumns } from "./_components/columns";
import { InvoiceToolbar } from "./_components/invoice-filters";
import {
  XmlViewerDialog,
  CancellationDialog,
  BulkValidationDialog,
  ComplementsDialog,
} from "./_components/invoice-dialogs";
import { DetailPanelChildren } from "./_components/invoice-detail-panel";
import { useFacturasState } from "./_components/use-facturas-state";

/* ---------- Main Page Component ---------- */

export default function FacturasPage() {
  const state = useFacturasState();

  // Columns
  const payableColumns = useInvoiceColumns("payable", state.handleAction);
  const receivableColumns = useInvoiceColumns("receivable", state.handleAction);

  // Empty state
  const emptyState = (
    <EmptyState
      icon={FileText}
      title="No hay facturas"
      description={
        state.hasDataButFilteredOut
          ? "Los filtros no coinciden con ninguna factura. Prueba a limpiar filtros."
          : "No se encontraron facturas con los filtros seleccionados. Sincroniza tu ERP (Odoo) para importar facturas."
      }
      action={
        state.hasDataButFilteredOut
          ? { label: "Limpiar filtros", onClick: () => state.setFilterBarValues({}) }
          : { label: "Sincronizar Odoo", onClick: state.handleSyncOdoo }
      }
    />
  );

  // Toolbar
  const toolbar = (
    <InvoiceToolbar
      searchValue={state.filters.search}
      onSearchChange={state.handleSearchChange}
      onBulkValidation={state.handleBulkValidation}
      bulkRunning={state.bulkRunning}
      onRefresh={state.handleRefresh}
      filterBarValues={state.filterBarValues}
      onFilterBarChange={state.setFilterBarValues}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Facturas</h1>
        <p className="text-muted-foreground text-sm">
          Gestiona facturas por pagar y por cobrar. Valida CFDI contra el SAT, registra pagos y
          genera links de cobro.
        </p>
      </div>

      {/* Unvalidated Banner */}
      {state.unvalidatedCount > 0 && state.canValidate && (
        <div className="flex items-center justify-between rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-yellow-600" />
            <span className="text-sm font-medium text-yellow-800">
              Tienes {state.unvalidatedCount} facturas sin validar contra el SAT
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-yellow-400 text-yellow-800 hover:bg-yellow-100"
            onClick={state.handleBulkValidation}
            disabled={state.bulkRunning}
          >
            {state.bulkRunning ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <ShieldCheck className="mr-1.5 size-4" />
            )}
            Validar Todo
          </Button>
        </div>
      )}

      {/* Tabs */}
      <Tabs
        value={state.activeTab}
        onValueChange={(v) => state.setActiveTab(v as "payable" | "receivable")}
      >
        <TabsList>
          <TabsTrigger value="payable" className="gap-1.5">
            <FileText className="size-4" />
            Por Pagar
            {state.payableData.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs">
                {state.payableData.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="receivable" className="gap-1.5">
            <FileText className="size-4" />
            Por Cobrar
            {state.receivableData.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs">
                {state.receivableData.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Por Pagar */}
        <TabsContent value="payable" className="mt-4">
          <DataTable
            columns={payableColumns}
            data={state.filteredData}
            isLoading={state.payableQuery.isLoading}
            onRowClick={state.handleRowClick}
            emptyState={emptyState}
            toolbar={toolbar}
            pagination={{
              page: state.filters.page,
              pageSize: state.filters.per_page,
              total: state.filteredData.length,
            }}
            onPaginationChange={(p) =>
              state.setFilters({ page: p.page, per_page: p.pageSize })
            }
          />
        </TabsContent>

        {/* Por Cobrar */}
        <TabsContent value="receivable" className="mt-4">
          <DataTable
            columns={receivableColumns}
            data={state.filteredData}
            isLoading={state.receivableQuery.isLoading}
            onRowClick={state.handleRowClick}
            emptyState={emptyState}
            toolbar={toolbar}
            pagination={{
              page: state.filters.page,
              pageSize: state.filters.per_page,
              total: state.filteredData.length,
            }}
            onPaginationChange={(p) =>
              state.setFilters({ page: p.page, per_page: p.pageSize })
            }
          />
        </TabsContent>
      </Tabs>

      {/* Detail Panel */}
      <DetailPanel
        isOpen={state.detailOpen}
        onClose={() => {
          state.setDetailOpen(false);
          state.setSelectedInvoice(null);
        }}
        title={state.selectedInvoice?.name || "Detalle de Factura"}
        tabs={["Detalle", "Pagos", "CFDI"]}
      >
        <DetailPanelChildren
          selectedInvoice={state.selectedInvoice}
          onViewXml={() => {
            if (state.selectedInvoice) {
              state.setXmlInvoiceId(state.selectedInvoice.id);
              state.setXmlDialogOpen(true);
            }
          }}
          onValidate={() => {
            if (state.selectedInvoice) {
              state.handleValidateSingle(state.selectedInvoice);
            }
          }}
        />
      </DetailPanel>

      {/* XML Dialog */}
      <XmlViewerDialog
        open={state.xmlDialogOpen}
        onOpenChange={state.setXmlDialogOpen}
        invoiceId={state.xmlInvoiceId}
      />

      {/* Cancellation Dialog */}
      <PermissionGate permission="invoices:cancel-cfdi">
        <CancellationDialog
          open={state.cancelDialogOpen}
          onOpenChange={state.setCancelDialogOpen}
          invoice={state.cancelInvoice}
        />
      </PermissionGate>

      {/* Complements Dialog */}
      <ComplementsDialog
        open={state.complementsDialogOpen}
        onOpenChange={state.setComplementsDialogOpen}
        invoice={state.complementsInvoice}
      />

      {/* Bulk Validation Dialog */}
      <BulkValidationDialog
        open={state.bulkDialogOpen}
        onOpenChange={state.setBulkDialogOpen}
        results={state.bulkResults}
        progress={state.bulkProgress}
        total={state.bulkTotal}
        isRunning={state.bulkRunning}
      />
    </div>
  );
}
