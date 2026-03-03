"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import {
  Loader2,
  TrendingUp,
  Clock,
  ShieldCheck,
  BarChart3,
  Users,
  Receipt,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

/* ---------- helpers ---------- */

function formatMXN(amount: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(amount);
}

function formatPct(val: number): string {
  return `${val.toFixed(1)}%`;
}

/* ---------- Expandable Report Card wrapper ---------- */

interface ReportCardProps {
  title: string;
  description: string;
  icon: React.ElementType;
  children: React.ReactNode;
  result: any;
  resultContent: React.ReactNode;
}

function ReportCard({
  title,
  description,
  icon: Icon,
  children,
  result,
  resultContent,
}: ReportCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-5" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          {children}

          {result && (
            <>
              <Separator />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded(!expanded)}
                className="w-full"
              >
                {expanded ? (
                  <>
                    <ChevronUp className="mr-2 size-4" />
                    Ocultar resultados
                  </>
                ) : (
                  <>
                    <ChevronDown className="mr-2 size-4" />
                    Ver resultados
                  </>
                )}
              </Button>
              {expanded && <div className="mt-2">{resultContent}</div>}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- Main Page ---------- */

export default function ReportesPage() {
  /* ---- Cash Flow ---- */
  const [cfFrom, setCfFrom] = useState("");
  const [cfTo, setCfTo] = useState("");
  const [cfLoading, setCfLoading] = useState(false);
  const [cfResult, setCfResult] = useState<any | null>(null);

  /* ---- Aging ---- */
  const [agingLoading, setAgingLoading] = useState<string | null>(null);
  const [agingResult, setAgingResult] = useState<any | null>(null);
  const [agingType, setAgingType] = useState<string | null>(null);

  /* ---- SAT Compliance ---- */
  const [satDays, setSatDays] = useState("30");
  const [satLoading, setSatLoading] = useState(false);
  const [satResult, setSatResult] = useState<any | null>(null);

  /* ---- Budget vs Actual ---- */
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [budgetResult, setBudgetResult] = useState<any[] | null>(null);

  /* ---- Vendor Summary ---- */
  const [vendorLoading, setVendorLoading] = useState(false);
  const [vendorResult, setVendorResult] = useState<any[] | null>(null);

  /* ---- Expenses ---- */
  const [expensesLoading, setExpensesLoading] = useState(false);
  const [expensesResult, setExpensesResult] = useState<any | null>(null);

  /* ---- Handlers ---- */

  async function handleCashFlow() {
    if (!cfFrom || !cfTo) {
      toast.error("Selecciona el rango de fechas");
      return;
    }
    setCfLoading(true);
    setCfResult(null);
    try {
      const result = await api.reports.cashFlow(cfFrom, cfTo);
      setCfResult(result);
      toast.success("Reporte de flujo de efectivo generado");
    } catch (err: any) {
      toast.error(err.message || "Error al generar reporte de flujo de efectivo");
    } finally {
      setCfLoading(false);
    }
  }

  async function handleAging(type: "receivable" | "payable") {
    setAgingLoading(type);
    setAgingResult(null);
    setAgingType(null);
    try {
      const result = await api.reports.aging(type);
      setAgingResult(result);
      setAgingType(type);
      toast.success(
        type === "receivable"
          ? "Reporte de cuentas por cobrar generado"
          : "Reporte de cuentas por pagar generado"
      );
    } catch (err: any) {
      toast.error(err.message || "Error al generar reporte de aging");
    } finally {
      setAgingLoading(null);
    }
  }

  async function handleSatCompliance() {
    setSatLoading(true);
    setSatResult(null);
    try {
      const result = await api.reports.satCompliance(parseInt(satDays, 10));
      setSatResult(result);
      toast.success("Reporte de cumplimiento SAT generado");
    } catch (err: any) {
      toast.error(err.message || "Error al generar reporte SAT");
    } finally {
      setSatLoading(false);
    }
  }

  async function handleBudgetVsActual() {
    setBudgetLoading(true);
    setBudgetResult(null);
    try {
      const result = await api.reports.budgetVsActual();
      setBudgetResult(result);
      toast.success("Reporte presupuesto vs actual generado");
    } catch (err: any) {
      toast.error(err.message || "Error al generar reporte de presupuesto");
    } finally {
      setBudgetLoading(false);
    }
  }

  async function handleVendorSummary() {
    setVendorLoading(true);
    setVendorResult(null);
    try {
      const result = await api.reports.vendorSummary();
      setVendorResult(result);
      toast.success("Resumen de proveedores generado");
    } catch (err: any) {
      toast.error(err.message || "Error al generar resumen de proveedores");
    } finally {
      setVendorLoading(false);
    }
  }

  async function handleExpenses() {
    setExpensesLoading(true);
    setExpensesResult(null);
    try {
      const result = await api.reports.expenses();
      setExpensesResult(result);
      toast.success("Reporte de gastos generado");
    } catch (err: any) {
      toast.error(err.message || "Error al generar reporte de gastos");
    } finally {
      setExpensesLoading(false);
    }
  }

  /* ---------- render ---------- */

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reportes</h1>
        <p className="text-muted-foreground text-sm">
          Genera y consulta reportes financieros, fiscales y operativos.
        </p>
      </div>

      {/* Report Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* 1. Cash Flow */}
        <ReportCard
          title="Flujo de Efectivo"
          description="Analisis de ingresos y egresos por periodo."
          icon={TrendingUp}
          result={cfResult}
          resultContent={
            cfResult && (
              <div className="grid gap-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Total Ingresos</p>
                    <p className="text-lg font-bold text-green-600">
                      {formatMXN(cfResult.total_inflows ?? cfResult.inflows ?? 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Total Egresos</p>
                    <p className="text-lg font-bold text-red-600">
                      {formatMXN(cfResult.total_outflows ?? cfResult.outflows ?? 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Flujo Neto</p>
                    <p className="text-lg font-bold">
                      {formatMXN(cfResult.net_flow ?? cfResult.net ?? 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Periodo</p>
                    <p className="text-sm">{cfFrom} a {cfTo}</p>
                  </div>
                </div>
                {Array.isArray(cfResult.details || cfResult.entries) && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead className="text-right">Ingresos</TableHead>
                        <TableHead className="text-right">Egresos</TableHead>
                        <TableHead className="text-right">Neto</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(cfResult.details || cfResult.entries).map((entry: any, idx: number) => (
                        <TableRow key={idx}>
                          <TableCell className="text-muted-foreground">
                            {entry.date || entry.period || "-"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-green-600">
                            {formatMXN(entry.inflows ?? entry.ingresos ?? 0)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-red-600">
                            {formatMXN(entry.outflows ?? entry.egresos ?? 0)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatMXN(entry.net ?? entry.neto ?? 0)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            )
          }
        >
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="cf-from">Desde</Label>
              <Input
                id="cf-from"
                type="date"
                value={cfFrom}
                onChange={(e) => setCfFrom(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cf-to">Hasta</Label>
              <Input
                id="cf-to"
                type="date"
                value={cfTo}
                onChange={(e) => setCfTo(e.target.value)}
              />
            </div>
          </div>
          <Button onClick={handleCashFlow} disabled={cfLoading} className="w-full">
            {cfLoading ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <TrendingUp className="mr-2 size-4" />
            )}
            Generar
          </Button>
        </ReportCard>

        {/* 2. Aging */}
        <ReportCard
          title="Aging Cartera"
          description="Antiguedad de cuentas por cobrar y por pagar."
          icon={Clock}
          result={agingResult}
          resultContent={
            agingResult && (
              <div className="grid gap-4">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">
                    {agingType === "receivable" ? "Cuentas por Cobrar" : "Cuentas por Pagar"}
                  </Badge>
                </div>
                {Array.isArray(agingResult.buckets || agingResult) ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Rango</TableHead>
                        <TableHead className="text-right">Monto</TableHead>
                        <TableHead className="text-right">Facturas</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(agingResult.buckets || agingResult).map((bucket: any, idx: number) => (
                        <TableRow key={idx}>
                          <TableCell className="font-medium">
                            {bucket.range || bucket.bucket || bucket.label || "-"}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatMXN(bucket.amount ?? bucket.total ?? 0)}
                          </TableCell>
                          <TableCell className="text-right">
                            {bucket.count ?? bucket.invoices ?? "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Total</p>
                      <p className="text-lg font-bold">
                        {formatMXN(agingResult.total ?? 0)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Promedio dias</p>
                      <p className="text-lg font-bold">
                        {agingResult.avg_days ?? "-"}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )
          }
        >
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={() => handleAging("receivable")}
              disabled={agingLoading !== null}
              variant="outline"
              className="w-full"
            >
              {agingLoading === "receivable" ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <TrendingUp className="mr-2 size-4" />
              )}
              Cuentas por Cobrar
            </Button>
            <Button
              onClick={() => handleAging("payable")}
              disabled={agingLoading !== null}
              variant="outline"
              className="w-full"
            >
              {agingLoading === "payable" ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Clock className="mr-2 size-4" />
              )}
              Cuentas por Pagar
            </Button>
          </div>
        </ReportCard>

        {/* 3. SAT Compliance */}
        <ReportCard
          title="Cumplimiento SAT"
          description="Metricas de cumplimiento fiscal y validacion de CFDI."
          icon={ShieldCheck}
          result={satResult}
          resultContent={
            satResult && (
              <div className="grid gap-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Total Documentos</p>
                    <p className="text-lg font-bold">
                      {satResult.total_documents ?? satResult.total ?? "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Vigentes</p>
                    <p className="text-lg font-bold text-green-600">
                      {satResult.valid ?? satResult.vigentes ?? "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Cancelados</p>
                    <p className="text-lg font-bold text-red-600">
                      {satResult.cancelled ?? satResult.cancelados ?? "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Tasa de Cumplimiento</p>
                    <p className="text-lg font-bold">
                      {satResult.compliance_rate != null
                        ? formatPct(satResult.compliance_rate)
                        : satResult.compliance_pct != null
                        ? formatPct(satResult.compliance_pct)
                        : "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Sin Validar</p>
                    <p className="text-lg font-bold text-yellow-600">
                      {satResult.unvalidated ?? satResult.pending ?? "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Periodo</p>
                    <p className="text-sm">Ultimos {satDays} dias</p>
                  </div>
                </div>
              </div>
            )
          }
        >
          <div className="grid gap-2">
            <Label>Periodo (dias)</Label>
            <Select value={satDays} onValueChange={setSatDays}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Ultimos 7 dias</SelectItem>
                <SelectItem value="14">Ultimos 14 dias</SelectItem>
                <SelectItem value="30">Ultimos 30 dias</SelectItem>
                <SelectItem value="60">Ultimos 60 dias</SelectItem>
                <SelectItem value="90">Ultimos 90 dias</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleSatCompliance} disabled={satLoading} className="w-full">
            {satLoading ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <ShieldCheck className="mr-2 size-4" />
            )}
            Generar
          </Button>
        </ReportCard>

        {/* 4. Budget vs Actual */}
        <ReportCard
          title="Presupuesto vs Actual"
          description="Comparacion de presupuestos contra gastos reales."
          icon={BarChart3}
          result={budgetResult}
          resultContent={
            budgetResult && Array.isArray(budgetResult) && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Presupuesto</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead className="text-right">Presupuestado</TableHead>
                    <TableHead className="text-right">Actual</TableHead>
                    <TableHead className="text-right">Variacion</TableHead>
                    <TableHead className="text-right">Utilizacion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {budgetResult.map((item: any, idx: number) => {
                    const budgeted = item.amount_budgeted ?? item.budgeted ?? 0;
                    const spent = item.amount_spent ?? item.actual ?? 0;
                    const variance = budgeted - spent;
                    const utilization = item.utilization_pct ?? (budgeted > 0 ? (spent / budgeted) * 100 : 0);
                    return (
                      <TableRow key={item.id ?? idx}>
                        <TableCell className="font-medium">
                          {item.name || item.budget_name || "-"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {item.category || "-"}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatMXN(budgeted)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatMXN(spent)}
                        </TableCell>
                        <TableCell className={`text-right font-mono ${variance >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {formatMXN(variance)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge
                            variant={utilization > 100 ? "destructive" : utilization > 80 ? "secondary" : "outline"}
                          >
                            {formatPct(utilization)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )
          }
        >
          <Button onClick={handleBudgetVsActual} disabled={budgetLoading} className="w-full">
            {budgetLoading ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <BarChart3 className="mr-2 size-4" />
            )}
            Generar
          </Button>
        </ReportCard>

        {/* 5. Vendor Summary */}
        <ReportCard
          title="Resumen Proveedores"
          description="Resumen de pagos y saldos por proveedor."
          icon={Users}
          result={vendorResult}
          resultContent={
            vendorResult && Array.isArray(vendorResult) && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Proveedor</TableHead>
                    <TableHead>RFC</TableHead>
                    <TableHead className="text-right">Total Pagado</TableHead>
                    <TableHead className="text-right">Pendiente</TableHead>
                    <TableHead className="text-right">Facturas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vendorResult.map((vendor: any, idx: number) => (
                    <TableRow key={vendor.id ?? idx}>
                      <TableCell className="font-medium">
                        {vendor.name || vendor.vendor_name || "-"}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {vendor.rfc || vendor.vat || "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatMXN(vendor.total_paid ?? vendor.paid ?? 0)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatMXN(vendor.total_pending ?? vendor.pending ?? 0)}
                      </TableCell>
                      <TableCell className="text-right">
                        {vendor.invoice_count ?? vendor.bills ?? "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          }
        >
          <Button onClick={handleVendorSummary} disabled={vendorLoading} className="w-full">
            {vendorLoading ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Users className="mr-2 size-4" />
            )}
            Generar
          </Button>
        </ReportCard>

        {/* 6. Expenses Report */}
        <ReportCard
          title="Reporte de Gastos"
          description="Desglose de gastos por categoria y periodo."
          icon={Receipt}
          result={expensesResult}
          resultContent={
            expensesResult && (
              <div className="grid gap-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Total Gastos</p>
                    <p className="text-lg font-bold">
                      {formatMXN(expensesResult.total ?? expensesResult.total_amount ?? 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Numero de Gastos</p>
                    <p className="text-lg font-bold">
                      {expensesResult.count ?? expensesResult.total_count ?? "-"}
                    </p>
                  </div>
                </div>
                {Array.isArray(expensesResult.by_category || expensesResult.categories) && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Categoria</TableHead>
                        <TableHead className="text-right">Monto</TableHead>
                        <TableHead className="text-right">Cantidad</TableHead>
                        <TableHead className="text-right">% del Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(expensesResult.by_category || expensesResult.categories).map(
                        (cat: any, idx: number) => (
                          <TableRow key={idx}>
                            <TableCell className="font-medium capitalize">
                              {cat.category || cat.name || "-"}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatMXN(cat.amount ?? cat.total ?? 0)}
                            </TableCell>
                            <TableCell className="text-right">
                              {cat.count ?? "-"}
                            </TableCell>
                            <TableCell className="text-right">
                              {cat.percentage != null
                                ? formatPct(cat.percentage)
                                : "-"}
                            </TableCell>
                          </TableRow>
                        )
                      )}
                    </TableBody>
                  </Table>
                )}
                {Array.isArray(expensesResult.by_employee || expensesResult.employees) && (
                  <>
                    <Separator />
                    <p className="text-sm font-medium">Por Empleado</p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Empleado</TableHead>
                          <TableHead className="text-right">Monto</TableHead>
                          <TableHead className="text-right">Gastos</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(expensesResult.by_employee || expensesResult.employees).map(
                          (emp: any, idx: number) => (
                            <TableRow key={idx}>
                              <TableCell className="font-medium">
                                {emp.employee || emp.name || "-"}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {formatMXN(emp.amount ?? emp.total ?? 0)}
                              </TableCell>
                              <TableCell className="text-right">
                                {emp.count ?? "-"}
                              </TableCell>
                            </TableRow>
                          )
                        )}
                      </TableBody>
                    </Table>
                  </>
                )}
              </div>
            )
          }
        >
          <Button onClick={handleExpenses} disabled={expensesLoading} className="w-full">
            {expensesLoading ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Receipt className="mr-2 size-4" />
            )}
            Generar
          </Button>
        </ReportCard>
      </div>
    </div>
  );
}
