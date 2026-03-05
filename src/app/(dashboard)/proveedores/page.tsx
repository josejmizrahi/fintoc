"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { Vendor, Invoice } from "@/types";
import { toast } from "sonner";
import {
  Users,
  UserCheck,
  FileText,
  ExternalLink,
  Edit,
  Check,
  Loader2,
  X,
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

/* ---------- Edit CLABE Dialog ---------- */

interface EditClabeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendor: Vendor | null;
  onSuccess: () => void;
}

function EditClabeDialog({
  open,
  onOpenChange,
  vendor,
  onSuccess,
}: EditClabeDialogProps) {
  const [clabe, setClabe] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && vendor) {
      setClabe(vendor.clabe || "");
    }
  }, [open, vendor]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!vendor) return;

    const trimmed = clabe.replace(/\s/g, "");
    if (trimmed.length !== 18 || !/^\d{18}$/.test(trimmed)) {
      toast.error("La CLABE debe tener exactamente 18 dígitos numéricos");
      return;
    }

    setSaving(true);
    try {
      await api.vendors.setClabe(vendor.id, trimmed);
      toast.success("CLABE actualizada exitosamente");
      onOpenChange(false);
      onSuccess();
    } catch (err: any) {
      toast.error(err.message || "Error al guardar CLABE");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit className="size-5" />
            Editar CLABE
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSave} className="grid gap-4 py-2">
          <p className="text-sm text-muted-foreground">
            Proveedor:{" "}
            <span className="font-medium text-foreground">
              {vendor?.name || "-"}
            </span>
          </p>

          <div className="grid gap-2">
            <Label htmlFor="clabe-input">CLABE Interbancaria (18 dígitos)</Label>
            <Input
              id="clabe-input"
              placeholder="000000000000000000"
              maxLength={18}
              value={clabe}
              onChange={(e) =>
                setClabe(e.target.value.replace(/\D/g, "").slice(0, 18))
              }
              className="font-mono tracking-wider"
            />
            <p className="text-xs text-muted-foreground">
              {clabe.length}/18 dígitos
            </p>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={saving || clabe.length !== 18}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Guardar CLABE
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Vendor Detail Panel ---------- */

interface VendorDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendorId: number | null;
}

function VendorDetailDialog({
  open,
  onOpenChange,
  vendorId,
}: VendorDetailDialogProps) {
  const [vendor, setVendor] = useState<any>(null);
  const [bills, setBills] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !vendorId) return;
    setLoading(true);
    setVendor(null);
    setBills([]);

    Promise.all([api.vendors.get(vendorId), api.vendors.bills(vendorId)])
      .then(([v, b]) => {
        setVendor(v);
        setBills(b);
      })
      .catch((err: any) =>
        toast.error(err.message || "Error al cargar detalle del proveedor")
      )
      .finally(() => setLoading(false));
  }, [open, vendorId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-5" />
            Detalle del Proveedor
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : !vendor ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No se encontraron datos del proveedor.
          </p>
        ) : (
          <div className="grid gap-6 py-2">
            {/* Vendor Info */}
            <div className="grid gap-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Información
              </h3>
              <div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
                <span className="font-medium text-muted-foreground">Nombre</span>
                <span>{vendor.name || "-"}</span>
              </div>
              <div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
                <span className="font-medium text-muted-foreground">RFC</span>
                <span className="font-mono">{vendor.rfc || "-"}</span>
              </div>
              <div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
                <span className="font-medium text-muted-foreground">Email</span>
                <span>{vendor.email || "-"}</span>
              </div>
              <div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
                <span className="font-medium text-muted-foreground">CLABE</span>
                <span className="font-mono">
                  {vendor.clabe || (
                    <span className="text-muted-foreground italic">
                      Sin CLABE registrada
                    </span>
                  )}
                </span>
              </div>
            </div>

            {/* Bills */}
            <div className="grid gap-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Facturas ({bills.length})
              </h3>
              {bills.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No hay facturas registradas para este proveedor.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Factura</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                      <TableHead>Vencimiento</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bills.map((bill) => (
                      <TableRow key={bill.id}>
                        <TableCell className="font-medium">
                          {bill.name || `FAC-${bill.id}`}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatMXN(bill.amount_total ?? 0)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatMXN(bill.amount_residual ?? 0)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(bill.date_due)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Main Page ---------- */

export default function ProveedoresPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);

  // Edit CLABE dialog
  const [editClabeOpen, setEditClabeOpen] = useState(false);
  const [editClabeVendor, setEditClabeVendor] = useState<Vendor | null>(null);

  // Vendor detail dialog
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailVendorId, setDetailVendorId] = useState<number | null>(null);

  // Verify loading
  const [verifyingId, setVerifyingId] = useState<number | null>(null);

  const fetchVendors = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.vendors.list();
      setVendors(data);
    } catch (err: any) {
      toast.error(err.message || "Error al cargar proveedores");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVendors();
  }, [fetchVendors]);

  async function handleVerifyClabe(vendor: Vendor) {
    setVerifyingId(vendor.id);
    try {
      const result = await api.vendors.verify(vendor.id);
      if (result.valid || result.verified) {
        toast.success(`CLABE de ${vendor.name} verificada correctamente`);
      } else {
        toast.error(
          result.message || `La CLABE de ${vendor.name} no pudo ser verificada`
        );
      }
    } catch (err: any) {
      toast.error(err.message || "Error al verificar CLABE");
    } finally {
      setVerifyingId(null);
    }
  }

  function handleEditClabe(vendor: Vendor) {
    setEditClabeVendor(vendor);
    setEditClabeOpen(true);
  }

  function handleViewBills(vendor: Vendor) {
    setDetailVendorId(vendor.id);
    setDetailOpen(true);
  }

  function handleNameClick(vendor: Vendor) {
    setDetailVendorId(vendor.id);
    setDetailOpen(true);
  }

  /* ---------- render ---------- */

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Proveedores</h1>
          <p className="text-muted-foreground text-sm">
            Gestiona proveedores, CLABEs y facturas por pagar.
          </p>
        </div>
      </div>

      {/* Vendors Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-5" />
            Lista de Proveedores
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : vendors.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No hay proveedores registrados.
            </p>
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
                {vendors.map((vendor) => (
                  <TableRow key={vendor.id}>
                    <TableCell className="font-medium">#{vendor.id}</TableCell>
                    <TableCell>
                      <button
                        className="text-left font-medium text-primary hover:underline cursor-pointer"
                        onClick={() => handleNameClick(vendor)}
                      >
                        {vendor.name || "-"}
                      </button>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {vendor.rfc || "-"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {vendor.email || "-"}
                    </TableCell>
                    <TableCell>
                      {vendor.clabe ? (
                        <span className="font-mono text-xs">
                          {vendor.clabe}
                        </span>
                      ) : (
                        <Badge variant="outline">Sin CLABE</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleViewBills(vendor)}
                          title="Ver facturas"
                        >
                          <FileText className="mr-1.5 size-3.5" />
                          Ver facturas
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleVerifyClabe(vendor)}
                          disabled={!vendor.clabe || verifyingId === vendor.id}
                          title="Verificar CLABE"
                        >
                          {verifyingId === vendor.id ? (
                            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                          ) : (
                            <UserCheck className="mr-1.5 size-3.5" />
                          )}
                          Verificar
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditClabe(vendor)}
                          title="Editar CLABE"
                        >
                          <Edit className="mr-1.5 size-3.5" />
                          CLABE
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

      {/* Edit CLABE Dialog */}
      <EditClabeDialog
        open={editClabeOpen}
        onOpenChange={setEditClabeOpen}
        vendor={editClabeVendor}
        onSuccess={fetchVendors}
      />

      {/* Vendor Detail Dialog */}
      <VendorDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        vendorId={detailVendorId}
      />
    </div>
  );
}
