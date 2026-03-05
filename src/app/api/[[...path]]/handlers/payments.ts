/**
 * Payment handlers — extracted from catch-all route (#16)
 */

import { query, insert, update, queryPaginated } from "@/lib/db";
import { fintocGet, fintocPost } from "@/lib/fintoc";
import { z } from "zod";
import { NextResponse } from "next/server";

const paymentSchema = z.object({
  amount: z.number().positive("Monto debe ser positivo"),
  currency: z.string().default("MXN"),
  partner_name: z.string().min(1, "Nombre del proveedor requerido"),
  partner_rfc: z.string().optional(),
  clabe: z.string().regex(/^\d{18}$/, "CLABE debe tener 18 digitos").optional(),
  comment: z.string().optional(),
  reference_id: z.string().optional(),
});

function zodError(error: z.ZodError): Response {
  const msg = error.issues.map((i) => i.message).join(", ");
  return NextResponse.json({ detail: msg }, { status: 400 });
}

function matchPath(path: string, pattern: string): Record<string, string> | null {
  const pp = path.split("/").filter(Boolean);
  const pt = pattern.split("/").filter(Boolean);
  if (pp.length !== pt.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pt.length; i++) {
    if (pt[i].startsWith(":")) params[pt[i].slice(1)] = pp[i];
    else if (pt[i] !== pp[i]) return null;
  }
  return params;
}

export async function handlePaymentsGet(path: string, companyId: number, page?: number, limit?: number): Promise<unknown | null> {
  if (path === "payments" || path === "payments/") {
    if (page) {
      const result = await queryPaginated("payments", { match: { company_id: companyId }, order: { column: "created_at" }, page, limit });
      return { data: result.data, pagination: { page: result.page, limit: result.limit, total: result.total, totalPages: result.totalPages } };
    }
    const { data } = await query("payments", { match: { company_id: companyId }, order: { column: "created_at" } });
    return data || [];
  }
  if (path === "payments/scheduled/list") {
    const { data } = await query("payments", { match: { company_id: companyId, status: "scheduled" }, order: { column: "scheduled_date", ascending: true } });
    return data || [];
  }
  const m = matchPath(path, "payments/:id");
  if (m) {
    const { data } = await query("payments", { match: { id: Number(m.id), company_id: companyId }, single: true });
    return data;
  }
  return null;
}

export async function handlePaymentsPost(path: string, body: Record<string, unknown>, companyId: number): Promise<Response | unknown | null> {
  // Create vendor payment
  if (path === "payments/vendor") {
    const normalized = {
      ...body,
      partner_name: (body.partner_name as string) || (body.vendor_name as string) || "",
      clabe: (body.clabe as string) || (body.clabe_destination as string) || undefined,
      reference_id: (body.reference_id as string) || undefined,
    };
    const parsed = paymentSchema.safeParse(normalized);
    if (!parsed.success) return zodError(parsed.error);
    const v = parsed.data;
    const { data } = await insert("payments", {
      company_id: companyId, direction: "outbound", status: "pending_approval",
      amount: v.amount, currency: v.currency,
      partner_name: v.partner_name, partner_rfc: v.partner_rfc || null,
      clabe_destination: v.clabe || null, comment: v.comment || null,
      reference_id: v.reference_id || `PAY-${Date.now()}`,
    });
    return data?.[0];
  }

  // Execute via Fintoc
  let m = matchPath(path, "payments/:id/execute");
  if (m) {
    const { data: payment } = await query("payments", { match: { id: Number(m.id), company_id: companyId }, single: true });
    if (!payment) return NextResponse.json({ detail: "Pago no encontrado" }, { status: 404 });

    try {
      const { data: fintocInt } = await query("integrations", { match: { company_id: companyId, provider: "fintoc" }, single: true });
      const fintocKey = fintocInt?.config ? (fintocInt.config as Record<string, string>).secretKey : null;

      if (fintocKey && fintocKey !== "••••••••") {
        const result = await fintocPost("/payment_intents", fintocKey, {
          amount: Math.round(Number(payment.amount) * 100),
          currency: "mxn",
          recipient_account: {
            holder_id: (payment.partner_rfc as string) || undefined,
            number: (payment.clabe_destination as string) || undefined,
            type: "clabe",
          },
          metadata: {
            payment_id: String(payment.id),
            reference: (payment.reference_id as string) || "",
            partner_name: (payment.partner_name as string) || "",
          },
        });

        if (result.ok && result.data) {
          await update("payments", {
            status: "processing", fintoc_payment_intent_id: result.data.id,
            updated_at: new Date().toISOString(),
          }, { id: Number(m.id), company_id: companyId });
          return { ...payment, status: "processing", fintoc_payment_intent_id: result.data.id };
        }
      }
    } catch { /* Fintoc not configured */ }

    const { data } = await update("payments", { status: "processing", updated_at: new Date().toISOString() }, { id: Number(m.id), company_id: companyId });
    return data?.[0];
  }

  // Poll status
  m = matchPath(path, "payments/:id/poll-status");
  if (m) {
    const { data: payment } = await query("payments", { match: { id: Number(m.id), company_id: companyId }, single: true });
    if (!payment) return NextResponse.json({ detail: "Pago no encontrado" }, { status: 404 });
    if (payment.status !== "processing") return payment;

    const piId = payment.fintoc_payment_intent_id as string;
    if (!piId) return payment;

    try {
      const { data: fintocInt } = await query("integrations", { match: { company_id: companyId, provider: "fintoc" }, single: true });
      const fintocKey = fintocInt?.config ? (fintocInt.config as Record<string, string>).secretKey : null;
      if (fintocKey && fintocKey !== "••••••••") {
        const pi = await fintocGet(`/payment_intents/${piId}`, fintocKey) as Record<string, unknown>;
        const piStatus = (pi.status as string) || "";
        if (piStatus === "succeeded") {
          await update("payments", { status: "confirmed", updated_at: new Date().toISOString() }, { id: Number(m.id), company_id: companyId });
          return { ...payment, status: "confirmed" };
        } else if (piStatus === "failed" || piStatus === "cancelled") {
          await update("payments", { status: "failed", updated_at: new Date().toISOString() }, { id: Number(m.id), company_id: companyId });
          return { ...payment, status: "failed" };
        }
        return { ...payment, fintoc_status: piStatus };
      }
    } catch { /* Fintoc unreachable */ }
    return payment;
  }

  // Bulk poll stuck
  if (path === "payments/poll-stuck") {
    const { data: stuck } = await query("payments", { match: { company_id: companyId, status: "processing" } });
    if (!stuck?.length) return { updated: 0, payments: [] };

    let fintocKey: string | null = null;
    try {
      const { data: fintocInt } = await query("integrations", { match: { company_id: companyId, provider: "fintoc" }, single: true });
      fintocKey = fintocInt?.config ? (fintocInt.config as Record<string, string>).secretKey : null;
      if (fintocKey === "••••••••") fintocKey = null;
    } catch { /* no integration */ }

    const results: Record<string, unknown>[] = [];
    for (const p of stuck) {
      const piId = p.fintoc_payment_intent_id as string;
      if (!piId || !fintocKey) { results.push({ id: p.id, status: "processing", reason: "no_fintoc_id" }); continue; }
      try {
        const pi = await fintocGet(`/payment_intents/${piId}`, fintocKey) as Record<string, unknown>;
        const piStatus = (pi.status as string) || "";
        if (piStatus === "succeeded") {
          await update("payments", { status: "confirmed", updated_at: new Date().toISOString() }, { id: p.id, company_id: companyId });
          results.push({ id: p.id, status: "confirmed" });
        } else if (piStatus === "failed" || piStatus === "cancelled") {
          await update("payments", { status: "failed", updated_at: new Date().toISOString() }, { id: p.id, company_id: companyId });
          results.push({ id: p.id, status: "failed" });
        } else {
          results.push({ id: p.id, status: "processing", fintoc_status: piStatus });
        }
      } catch { results.push({ id: p.id, status: "processing", reason: "fintoc_error" }); }
    }
    return { updated: results.filter(r => r.status !== "processing").length, payments: results };
  }

  // Schedule
  m = matchPath(path, "payments/:id/schedule");
  if (m) {
    const { data } = await update("payments", { status: "scheduled", updated_at: new Date().toISOString() }, { id: Number(m.id), company_id: companyId });
    return data?.[0];
  }

  return null;
}
