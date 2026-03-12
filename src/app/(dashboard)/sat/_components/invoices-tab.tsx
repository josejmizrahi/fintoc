"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  FileText,
  Download,
  RefreshCw,
  Eye,
  FileDown,
} from "lucide-react";

import { api } from "@/lib/api";
import { formatMoney, formatDate } from "@/lib/utils/format";

import { DataTable } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { SearchInput } from "@/components/shared/search-input";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { satKeys, cfdiTypeBadge, satStatusBadge } from "./helpers";
import { InvoiceDetailDialog } from "./invoice-detail-dialog";
import { NewExtractionDialog } from "./new-extraction-dialog";
import type { SyntageInvoice } from "./types";

export function InvoicesTab({ taxpayerId }: { taxpayerId: string }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [selectedInvoice, setSelectedInvoice] = useState<SyntageInvoice | null>(null);
  const [showExtractDialog, setShowExtractDialog] = useState(false);

  const params: Record<string, string> = {
    page: String(page),
    itemsPerPage: "25",
  };

  const invoicesQuery = useQuery({
    queryKey: satKeys.invoices(taxpayerId, params),
    queryFn: () => api.sat.syntage.invoices(taxpayerId, params),
    enabled: !!taxpayerId,
    staleTime: 30_000,
    placeholderData: (prev: unknown) => prev,
  });

  const extractMutation = useMutation({
    mutationFn: (data: { extractor?: string; options?: unknown }) =>
      api.sat.syntage.extract(taxpayerId, data.extractor, data.options as Record<string, unknown>),
    onSuccess: () => {
      toast.success("Extraction creada. Syntage descargara las facturas del SAT.");
      queryClient.invalidateQueries({ queryKey: satKeys.extractions() });
      setShowExtractDialog(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const invoices: SyntageInvoice[] = useMemo(() => invoicesQuery.data?.invoices || [], [invoicesQuery.data?.invoices]);
  const total = invoicesQuery.data?.total || 0;

  // Client-side search/filter on current page
  const filtered = useMemo(() => {
    let result = invoices;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (inv) =>
          inv.uuid?.toLowerCase().includes(q) ||
          inv.issuer?.name?.toLowerCase().includes(q) ||
          inv.issuer?.rfc?.toLowerCase().includes(q) ||
          inv.receiver?.name?.toLowerCase().includes(q) ||
          inv.receiver?.rfc?.toLowerCase().includes(q),
      );
    }
    if (typeFilter !== "all") {
      result = result.filter((inv) => inv.type === typeFilter);
    }
    return result;
  }, [invoices, search, typeFilter]);

  const columns: ColumnDef<SyntageInvoice>[] = [
    {
      accessorKey: "uuid",
      header: "UUID",
      cell: ({ row }) => (
        <span className="font-mono text-xs" title={row.original.uuid}>
          {row.original.uuid?.substring(0, 8)}...
        </span>
      ),
    },
    {
      id: "emisor",
      header: "Emisor",
      cell: ({ row }) => (
        <div>
          <p className="text-sm font-medium truncate max-w-[180px]">{row.original.issuer?.name}</p>
          <p className="text-xs text-muted-foreground">{row.original.issuer?.rfc}</p>
        </div>
      ),
    },
    {
      id: "receptor",
      header: "Receptor",
      cell: ({ row }) => (
        <div>
          <p className="text-sm font-medium truncate max-w-[180px]">{row.original.receiver?.name}</p>
          <p className="text-xs text-muted-foreground">{row.original.receiver?.rfc}</p>
        </div>
      ),
    },
    {
      accessorKey: "type",
      header: "Tipo",
      cell: ({ row }) => cfdiTypeBadge(row.original.type),
    },
    {
      accessorKey: "total",
      header: "Total",
      cell: ({ row }) => (
        <span className="text-right font-medium">
          {formatMoney(row.original.total, row.original.currency)}
        </span>
      ),
    },
    {
      accessorKey: "issuedAt",
      header: "Fecha",
      cell: ({ row }) => (
        <span className="text-sm">{row.original.issuedAt ? formatDate(row.original.issuedAt) : "-"}</span>
      ),
    },
    {
      accessorKey: "paymentMethod",
      header: "Metodo",
      cell: ({ row }) => {
        const pm = row.original.paymentMethod;
        if (!pm) return <span className="text-muted-foreground">-</span>;
        return (
          <Badge variant="outline" className={pm === "PPD" ? "bg-orange-100 text-orange-800" : "bg-blue-100 text-blue-800"}>
            {pm}
          </Badge>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Estado SAT",
      cell: ({ row }) => satStatusBadge(row.original.status),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <Eye className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setSelectedInvoice(row.original)}>
              <Eye className="h-4 w-4 mr-2" /> Ver detalle
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleDownloadCfdi(row.original.id, "xml")}>
              <FileDown className="h-4 w-4 mr-2" /> Descargar XML
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleDownloadCfdi(row.original.id, "pdf")}>
              <FileDown className="h-4 w-4 mr-2" /> Descargar PDF
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  async function handleDownloadCfdi(invoiceId: string, _format: string) {
    try {
      const data = await api.sat.syntage.invoiceCfdi(invoiceId);
      if (data.downloadUrl) window.open(data.downloadUrl, "_blank");
      else toast.info("CFDI descargado");
    } catch {
      toast.error("Error al descargar CFDI");
    }
  }

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1">
          <SearchInput
            placeholder="Buscar por UUID, RFC, nombre..."
            value={search}
            onChange={setSearch}
          />
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="I">Ingreso</SelectItem>
              <SelectItem value="E">Egreso</SelectItem>
              <SelectItem value="P">Pago</SelectItem>
              <SelectItem value="N">Nomina</SelectItem>
              <SelectItem value="T">Traslado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: satKeys.invoices(taxpayerId, params) })}>
            <RefreshCw className="h-4 w-4 mr-2" /> Actualizar
          </Button>
          <Button onClick={() => setShowExtractDialog(true)}>
            <Download className="h-4 w-4 mr-2" /> Sincronizar SAT
          </Button>
        </div>
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        data={filtered}
        isLoading={invoicesQuery.isLoading}
        pagination={{ page, pageSize: 25, total }}
        onPaginationChange={(p) => setPage(p.page)}
        onRowClick={setSelectedInvoice}
        emptyState={
          <EmptyState
            icon={FileText}
            title="No hay facturas CFDI"
            description="Sincroniza con el SAT para descargar tus facturas via Syntage."
            action={{ label: "Sincronizar SAT", onClick: () => setShowExtractDialog(true) }}
          />
        }
      />

      {/* Invoice Detail Dialog */}
      {selectedInvoice && (
        <InvoiceDetailDialog
          invoice={selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
        />
      )}

      {/* Extract Dialog */}
      <NewExtractionDialog
        open={showExtractDialog}
        onClose={() => setShowExtractDialog(false)}
        taxpayerId={taxpayerId}
        defaultExtractor="invoice"
        onSubmit={(extractor, options) => extractMutation.mutate({ extractor, options })}
        isLoading={extractMutation.isPending}
      />
    </>
  );
}
