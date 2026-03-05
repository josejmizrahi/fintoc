"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import { Customer, Invoice } from "@/types";
import { toast } from "sonner";
import {
  Users,
  UserCheck,
  Search,
  FileText,
  ExternalLink,
  Loader2,
  Check,
  Plus,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

/* ---------- helpers ---------- */

function formatMXN(amount: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(amount);
}

function formatDate(dateStr?: string) {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/* ---------- Customer Invoices Dialog ---------- */

interface CustomerInvoicesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: Customer | null;
}

function CustomerInvoicesDialog({
  open,
  onOpenChange,
  customer,
}: CustomerInvoicesDialogProps) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !customer) return;
    setLoading(true);
    setInvoices([]);

    api.customers
      .invoices(customer.id)
      .then(setInvoices)
      .catch((err: any) =>
        toast.error(err.message || "Error al cargar facturas del cliente")
      )
      .finally(() => setLoading(false));
  }, [open, customer]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-5" />
            Facturas de {customer?.name || "Cliente"}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : invoices.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No hay facturas registradas para este cliente.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Factura</TableHead>
                <TableHead className="text-right">Monto Total</TableHead>
                <TableHead className="text-right">Saldo Pendiente</TableHead>
                <TableHead>Vencimiento</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-medium">
                    {inv.name || `FAC-${inv.id}`}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatMXN(inv.amount_total ?? 0)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatMXN(inv.amount_residual ?? 0)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(inv.date_due)}
                  </TableCell>
                  <TableCell>
                    {inv.status === "paid" ? (
                      <Badge variant="default">Pagada</Badge>
                    ) : inv.amount_residual && inv.amount_residual > 0 ? (
                      <Badge variant="secondary">Pendiente</Badge>
                    ) : (
                      <Badge variant="outline">-</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------- CLABE Dialog ---------- */

interface ClabeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: Customer | null;
}

function ClabeDialog({ open, onOpenChange, customer }: ClabeDialogProps) {
  const [clabeData, setClabeData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !customer) return;
    setLoading(true);
    setClabeData(null);

    api.customers
      .clabe(customer.id)
      .then(setClabeData)
      .catch((err: any) =>
        toast.error(err.message || "Error al cargar CLABE del cliente")
      )
      .finally(() => setLoading(false));
  }, [open, customer]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Check className="size-5" />
            CLABE de {customer?.name || "Cliente"}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : !clabeData ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No se encontraron datos de CLABE para este cliente.
          </p>
        ) : (
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
              <span className="font-medium text-muted-foreground">Cliente</span>
              <span>{customer?.name || "-"}</span>
            </div>
            <div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
              <span className="font-medium text-muted-foreground">CLABE</span>
              <span className="font-mono tracking-wider">
                {clabeData.clabe || customer?.clabe || "-"}
              </span>
            </div>
            {clabeData.bank && (
              <div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
                <span className="font-medium text-muted-foreground">Banco</span>
                <span>{clabeData.bank}</span>
              </div>
            )}
            {clabeData.status && (
              <div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
                <span className="font-medium text-muted-foreground">Estado</span>
                <Badge
                  variant={
                    clabeData.status === "active" ? "default" : "secondary"
                  }
                >
                  {clabeData.status === "active" ? "Activa" : clabeData.status}
                </Badge>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Create Customer Dialog ---------- */

interface CreateCustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

function CreateCustomerDialog({ open, onOpenChange, onSuccess }: CreateCustomerDialogProps) {
  const [name, setName] = useState("");
  const [rfc, setRfc] = useState("");
  const [email, setEmail] = useState("");
  const [clabe, setClabe] = useState("");
  const [saving, setSaving] = useState(false);

  function resetForm() {
    setName("");
    setRfc("");
    setEmail("");
    setClabe("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("El nombre del cliente es requerido");
      return;
    }
    setSaving(true);
    try {
      await api.customers.create({
        name: name.trim(),
        rfc: rfc.trim() || undefined,
        email: email.trim() || undefined,
        clabe: clabe.trim() || undefined,
      });
      toast.success("Cliente creado exitosamente");
      resetForm();
      onOpenChange(false);
      onSuccess();
    } catch (err: any) {
      toast.error(err.message || "Error al crear cliente");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo Cliente</DialogTitle>
          <DialogDescription>
            Ingresa los datos del cliente.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="customer-name">Nombre *</Label>
            <Input id="customer-name" placeholder="Nombre del cliente" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="customer-rfc">RFC</Label>
            <Input id="customer-rfc" placeholder="XAXX010101000" maxLength={13} value={rfc} onChange={(e) => setRfc(e.target.value.toUpperCase())} className="font-mono" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="customer-email">Email</Label>
            <Input id="customer-email" type="email" placeholder="cliente@empresa.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="customer-clabe">CLABE (18 dígitos)</Label>
            <Input id="customer-clabe" placeholder="000000000000000000" maxLength={18} value={clabe} onChange={(e) => setClabe(e.target.value.replace(/\D/g, "").slice(0, 18))} className="font-mono tracking-wider" />
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Crear
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Main Page ---------- */

export default function ClientesPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);

  // Invoices dialog
  const [invoicesOpen, setInvoicesOpen] = useState(false);
  const [invoicesCustomer, setInvoicesCustomer] = useState<Customer | null>(
    null
  );

  // CLABE dialog
  const [clabeOpen, setClabeOpen] = useState(false);
  const [clabeCustomer, setClabeCustomer] = useState<Customer | null>(null);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.customers.list();
      setCustomers(data);
    } catch (err: any) {
      toast.error(err.message || "Error al cargar clientes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  // Debounced search
  function handleSearchChange(value: string) {
    setSearchQuery(value);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!value.trim()) {
      debounceRef.current = setTimeout(() => {
        fetchCustomers();
      }, 100);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await api.customers.search(value.trim());
        setCustomers(results);
      } catch (err: any) {
        toast.error(err.message || "Error en la búsqueda");
      } finally {
        setSearching(false);
      }
    }, 350);
  }

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  function handleViewInvoices(customer: Customer) {
    setInvoicesCustomer(customer);
    setInvoicesOpen(true);
  }

  function handleViewClabe(customer: Customer) {
    setClabeCustomer(customer);
    setClabeOpen(true);
  }

  /* ---------- render ---------- */

  return (
    <div className="flex flex-col gap-6">
      {/* Header with search */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clientes</h1>
          <p className="text-muted-foreground text-sm">
            Consulta y busca clientes, sus facturas y CLABEs.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 size-4" />
          Nuevo Cliente
        </Button>
      </div>

      {/* Search bar */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nombre, RFC o email..."
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="pl-9"
        />
        {searching && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Customers Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-5" />
            Lista de Clientes
            {searchQuery && (
              <Badge variant="secondary" className="ml-2">
                Búsqueda: &quot;{searchQuery}&quot;
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : customers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <UserCheck className="size-8 mb-2" />
              <p className="text-sm">
                {searchQuery
                  ? "No se encontraron clientes con esa búsqueda."
                  : "No hay clientes registrados."}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>RFC</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>CLABE</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell className="font-medium">
                      #{customer.id}
                    </TableCell>
                    <TableCell className="font-medium">
                      {customer.name || "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono">
                        {customer.rfc || "-"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {customer.email || "-"}
                    </TableCell>
                    <TableCell>
                      {customer.clabe ? (
                        <span className="font-mono text-xs">
                          {customer.clabe}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleViewInvoices(customer)}
                          title="Ver facturas"
                        >
                          <FileText className="mr-1.5 size-3.5" />
                          Ver facturas
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleViewClabe(customer)}
                          title="Ver CLABE"
                        >
                          <ExternalLink className="mr-1.5 size-3.5" />
                          Ver CLABE
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Customer Dialog */}
      <CreateCustomerDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={fetchCustomers}
      />

      {/* Customer Invoices Dialog */}
      <CustomerInvoicesDialog
        open={invoicesOpen}
        onOpenChange={setInvoicesOpen}
        customer={invoicesCustomer}
      />

      {/* CLABE Dialog */}
      <ClabeDialog
        open={clabeOpen}
        onOpenChange={setClabeOpen}
        customer={clabeCustomer}
      />
    </div>
  );
}
