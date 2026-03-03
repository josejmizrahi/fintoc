"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import {
  BarChart3, TrendingUp, TrendingDown, Shield, PieChart, Users, Wallet, Loader2,
} from "lucide-react";
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from "@/components/ui/table";

function formatMXN(n: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
}

function ReportCard({
  title, description, icon: Icon, children, onGenerate, loading,
}: {
  title: string; description: string; icon: any;
  children: React.ReactNode; onGenerate: () => void; loading: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-4" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {children}
        <Button onClick={onGenerate} disabled={loading} className="w-full">
          {loading ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
          Generar
        </Button>
      </CardContent>
    </Card>
  );
}

export default function ReportesPage() {
  // Cash flow
  const [cfFrom, setCfFrom] = useState("");
  const [cfTo, setCfTo] = useState("");
  const [cfData, setCfData] = useState<any>(null);
  const [cfLoading, setCfLoading] = useState(false);

  // Aging
  const [agingType, setAgingType] = useState<"receivable" | "payable">("receivable");
  const [agingData, setAgingData] = useState<any>(null);
  const [agingLoading, setAgingLoading] = useState(false);

  // SAT
  const [satDays, setSatDays] = useState("30");
  const [satData, setSatData] = useState<any>(null);
  const [satLoading, setSatLoading] = useState(false);

  // Budget vs Actual
  const [bvaData, setBvaData] = useState<any[]>([]);
  const [bvaLoading, setBvaLoading] = useState(false);

  // Vendor Summary
  const [vendorData, setVendorData] = useState<any[]>([]);
  const [vendorLoading, setVendorLoading] = useState(false);

  // Expenses
  const [expData, setExpData] = useState<any>(null);
  const [expLoading, setExpLoading] = useState(false);

  async function genCashFlow() {
    setCfLoading(true);
    try {
      const data = await api.reports.cashFlow(cfFrom || undefined, cfTo || undefined);
      setCfData(data);
    } catch (err: any) { toast.error(err.message); } finally { setCfLoading(false); }
  }
  async function genAging() {
    setAgingLoading(true);
    try {
      const data = await api.reports.aging(agingType);
      setAgingData(data);
    } catch (err: any) { toast.error(err.message); } finally { setAgingLoading(false); }
  }
  async function genSat() {
    setSatLoading(true);
    try {
      const data = await api.reports.satCompliance(parseInt(satDays));
      setSatData(data);
    } catch (err: any) { toast.error(err.message); } finally { setSatLoading(false); }
  }
  async function genBva() {
    setBvaLoading(true);
    try {
      const data = await api.reports.budgetVsActual();
      setBvaData(data);
    } catch (err: any) { toast.error(err.message); } finally { setBvaLoading(false); }
  }
  async function genVendor() {
    setVendorLoading(true);
    try {
      const data = await api.reports.vendorSummary();
      setVendorData(data);
    } catch (err: any) { toast.error(err.message); } finally { setVendorLoading(false); }
  }
  async function genExpenses() {
    setExpLoading(true);
    try {
      const data = await api.reports.expenses();
      setExpData(data);
    } catch (err: any) { toast.error(err.message); } finally { setExpLoading(false); }
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reportes</h1>
        <p className="text-sm text-muted-foreground">Genera reportes financieros y de cumplimiento.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Cash Flow */}
        <ReportCard title="Flujo de Efectivo" description="Reporte de ingresos y egresos por periodo." icon={TrendingUp} onGenerate={genCashFlow} loading={cfLoading}>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label className="text-xs">Desde</Label>
              <Input type="date" value={cfFrom} onChange={(e) => setCfFrom(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Hasta</Label>
              <Input type="date" value={cfTo} onChange={(e) => setCfTo(e.target.value)} />
            </div>
          </div>
          {cfData && (
            <div className="rounded-md border p-3 text-sm space-y-1">
              <div className="flex justify-between"><span>Ingresos</span><span className="font-medium text-green-600">{formatMXN(cfData.total_inflows || 0)}</span></div>
              <div className="flex justify-between"><span>Egresos</span><span className="font-medium text-red-600">{formatMXN(cfData.total_outflows || 0)}</span></div>
              <div className="flex justify-between border-t pt-1"><span className="font-medium">Neto</span><span className="font-bold">{formatMXN(cfData.net_flow || 0)}</span></div>
            </div>
          )}
        </ReportCard>

        {/* Aging */}
        <ReportCard title="Aging de Cartera" description="Antiguedad de cuentas por cobrar o pagar." icon={TrendingDown} onGenerate={genAging} loading={agingLoading}>
          <div className="flex gap-2">
            <Button size="sm" variant={agingType === "receivable" ? "default" : "outline"} onClick={() => setAgingType("receivable")} className="flex-1">Por Cobrar</Button>
            <Button size="sm" variant={agingType === "payable" ? "default" : "outline"} onClick={() => setAgingType("payable")} className="flex-1">Por Pagar</Button>
          </div>
          {agingData && (
            <div className="rounded-md border p-3 text-sm space-y-1">
              {typeof agingData === "object" && !Array.isArray(agingData) ? (
                Object.entries(agingData).map(([k, v]: [string, any]) => (
                  <div key={k} className="flex justify-between">
                    <span>{k}</span>
                    <span className="font-medium">{typeof v === "number" ? formatMXN(v) : JSON.stringify(v)}</span>
                  </div>
                ))
              ) : (
                <p>Datos recibidos correctamente.</p>
              )}
            </div>
          )}
        </ReportCard>

        {/* SAT Compliance */}
        <ReportCard title="Cumplimiento SAT" description="Estado de validacion de CFDIs." icon={Shield} onGenerate={genSat} loading={satLoading}>
          <div className="grid gap-1">
            <Label className="text-xs">Dias</Label>
            <Input type="number" value={satDays} onChange={(e) => setSatDays(e.target.value)} />
          </div>
          {satData && (
            <div className="rounded-md border p-3 text-sm space-y-1">
              {typeof satData === "object" && Object.entries(satData).map(([k, v]: [string, any]) => (
                <div key={k} className="flex justify-between">
                  <span>{k.replace(/_/g, " ")}</span>
                  <span className="font-medium">{typeof v === "number" ? (k.includes("amount") || k.includes("total") ? formatMXN(v) : v) : JSON.stringify(v)}</span>
                </div>
              ))}
            </div>
          )}
        </ReportCard>

        {/* Budget vs Actual */}
        <ReportCard title="Presupuesto vs Actual" description="Compara presupuesto asignado contra gasto real." icon={PieChart} onGenerate={genBva} loading={bvaLoading}>
          <div />
          {bvaData.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead className="text-right">Presup.</TableHead>
                  <TableHead className="text-right">Real</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bvaData.map((r: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs">{r.name}</TableCell>
                    <TableCell className="text-right text-xs">{formatMXN(r.amount_budgeted || 0)}</TableCell>
                    <TableCell className="text-right text-xs">{formatMXN(r.amount_spent || 0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ReportCard>

        {/* Vendor Summary */}
        <ReportCard title="Resumen Proveedores" description="Resumen de pagos y facturas por proveedor." icon={Users} onGenerate={genVendor} loading={vendorLoading}>
          <div />
          {vendorData.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Proveedor</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendorData.map((r: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs">{r.name || r.vendor}</TableCell>
                    <TableCell className="text-right text-xs">{formatMXN(r.total || r.amount || 0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ReportCard>

        {/* Expenses Report */}
        <ReportCard title="Reporte de Gastos" description="Desglose de gastos por categoria." icon={Wallet} onGenerate={genExpenses} loading={expLoading}>
          <div />
          {expData && (
            <div className="rounded-md border p-3 text-sm space-y-1">
              {typeof expData === "object" && Object.entries(expData).map(([k, v]: [string, any]) => (
                <div key={k} className="flex justify-between">
                  <span>{k.replace(/_/g, " ")}</span>
                  <span className="font-medium">{typeof v === "number" ? formatMXN(v) : JSON.stringify(v)}</span>
                </div>
              ))}
            </div>
          )}
        </ReportCard>
      </div>
    </div>
  );
}
