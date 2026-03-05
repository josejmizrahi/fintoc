import { NextRequest, NextResponse } from "next/server";
import { hasDB, query, insert, update } from "@/lib/db";
import { getCompanyId, maskConfig, resolveConfig } from "@/lib/auth-helpers";
import { odooJsonRpc, odooAuthenticate, odooFetchAll } from "@/lib/odoo";
import { fintocGet } from "@/lib/fintoc";
import { validateCfdiAgainstSat, testSatReachability } from "@/lib/sat";

// ── Sync log helpers ──

async function createSyncLog(companyId: number, provider: string, syncType: string, totalItems = 0) {
  const { data } = await insert("sync_logs", {
    company_id: companyId,
    provider,
    sync_type: syncType,
    status: "running",
    total_items: totalItems,
    processed_items: 0,
    started_at: new Date().toISOString(),
  });
  return data?.[0]?.id as number | undefined;
}

async function updateSyncLog(logId: number | undefined, fields: Record<string, unknown>) {
  if (!logId) return;
  await update("sync_logs", fields, { id: logId }).catch(() => {});
}

async function completeSyncLog(logId: number | undefined, status: string, processed: number, details: Record<string, unknown>, errorMessage?: string) {
  if (!logId) return;
  await update("sync_logs", {
    status,
    processed_items: processed,
    details,
    error_message: errorMessage || null,
    completed_at: new Date().toISOString(),
  }, { id: logId }).catch(() => {});
}

// ── GET /api/onboarding — integration status + masked configs ──

export async function GET(req: NextRequest) {
  const companyId = await getCompanyId(req);
  if (!companyId) return NextResponse.json({ detail: "No autorizado" }, { status: 401 });

  if (!hasDB()) {
    return NextResponse.json({
      integrations: { odoo: null, fintoc: null, sat: null },
      onboarding_completed: false,
    });
  }

  const { data: integrations } = await query("integrations", { match: { company_id: companyId } });
  const map: Record<string, unknown> = { odoo: null, fintoc: null, sat: null };
  for (const i of integrations || []) {
    const cfg = maskConfig(i.config as Record<string, string> | null);
    // Include cert file info if present
    if (i.provider === "sat" && cfg) {
      const rawCfg = i.config as Record<string, string> | null;
      if (rawCfg?.certFileName) cfg.certFileName = rawCfg.certFileName;
      if (rawCfg?.keyFileName) cfg.keyFileName = rawCfg.keyFileName;
    }
    map[i.provider as string] = {
      is_connected: i.is_connected,
      last_sync_at: i.last_sync_at,
      last_sync_status: i.last_sync_status,
      last_sync_message: i.last_sync_message,
      cert_uploaded_at: i.cert_uploaded_at,
      config: cfg,
    };
  }

  const { data: company } = await query("companies", { select: "onboarding_completed", match: { id: companyId }, single: true });
  return NextResponse.json({
    integrations: map,
    onboarding_completed: company?.onboarding_completed || false,
  });
}

// ── POST /api/onboarding — save, test, sync, complete ──

export async function POST(req: NextRequest) {
  const companyId = await getCompanyId(req);
  if (!companyId) return NextResponse.json({ detail: "No autorizado" }, { status: 401 });
  if (!hasDB()) return NextResponse.json({ detail: "DB no configurada" }, { status: 500 });

  const body = await req.json();
  const { action, provider, config } = body as {
    action: "save" | "test" | "sync" | "complete";
    provider?: string;
    config?: Record<string, string>;
  };

  if (action === "complete") {
    await update("companies", { onboarding_completed: true }, { id: companyId });
    return NextResponse.json({ success: true });
  }

  if (!provider || !["odoo", "fintoc", "sat", "general"].includes(provider)) {
    return NextResponse.json({ detail: "Proveedor invalido" }, { status: 400 });
  }

  const { data: existing } = await query("integrations", { match: { company_id: companyId, provider }, single: true });

  if (action === "save" && config) {
    const mergedConfig = resolveConfig(config, existing?.config as Record<string, string>);
    if (existing) {
      await update("integrations", { config: mergedConfig, updated_at: new Date().toISOString() }, { company_id: companyId, provider });
    } else {
      await insert("integrations", { company_id: companyId, provider, config: mergedConfig });
    }
    return NextResponse.json({ success: true });
  }

  const resolvedCfg = resolveConfig(config, existing?.config as Record<string, string>);

  if (action === "test") {
    if (provider === "odoo") return testOdoo(companyId, resolvedCfg);
    if (provider === "fintoc") return testFintoc(companyId, resolvedCfg);
    if (provider === "sat") return testSat(companyId, resolvedCfg);
  }

  if (action === "sync") {
    if (provider === "odoo") return syncOdoo(companyId, resolvedCfg);
    if (provider === "fintoc") return syncFintoc(companyId, resolvedCfg);
    if (provider === "sat") return syncSat(companyId, resolvedCfg);
  }

  return NextResponse.json({ detail: "Accion invalida" }, { status: 400 });
}

// ── Odoo: Test ──

async function testOdoo(companyId: number, config: Record<string, string>) {
  const { url, database, user, password } = config;
  if (!url || !database || !user || !password) {
    return NextResponse.json({ success: false, message: "Faltan campos requeridos (URL, base de datos, usuario, contrasena)" });
  }
  try {
    const versionResult = await odooJsonRpc(url, "common", "version", []);
    if (versionResult.error) throw new Error("No se pudo conectar al servidor Odoo");
    const version = versionResult.result as { server_version?: string } | null;
    const uid = await odooAuthenticate(url, database, user, password);
    const msg = `UID: ${uid}${version?.server_version ? ` — Odoo ${version.server_version}` : ""}`;
    await update("integrations", { is_connected: true, last_sync_status: "connected", last_sync_message: msg, updated_at: new Date().toISOString() }, { company_id: companyId, provider: "odoo" });
    return NextResponse.json({ success: true, message: `Conexion a Odoo exitosa (${msg})` });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    await update("integrations", { is_connected: false, last_sync_status: "error", last_sync_message: msg, updated_at: new Date().toISOString() }, { company_id: companyId, provider: "odoo" }).catch(() => {});
    return NextResponse.json({ success: false, message: `Error conectando a Odoo: ${msg}` });
  }
}

// ── Odoo: Full sync (with sync_logs tracking) ──

async function syncOdoo(companyId: number, config: Record<string, string>) {
  const { url, database, user, password } = config;
  if (!url || !database || !user || !password) {
    return NextResponse.json({ success: false, message: "Configuracion de Odoo incompleta" });
  }

  const logId = await createSyncLog(companyId, "odoo", "full");
  const errors: string[] = [];

  try {
    const uid = await odooAuthenticate(url, database, user, password);
    let syncedCustomers = 0, syncedVendors = 0, syncedInvoices = 0, updatedInvoices = 0, syncedPayments = 0;
    let totalProcessed = 0;

    // Customers
    try {
      const customers = await odooFetchAll(url, database, uid, password, "res.partner", [["customer_rank", ">", 0]], ["id", "name", "vat", "email"]);
      await updateSyncLog(logId, { total_items: customers.length, details: { phase: "customers", total_fetched: customers.length } });
      for (const c of customers) {
        if (!c.name) continue;
        const rfc = (c.vat as string) || null;
        const { data: existing } = rfc
          ? await query("customers", { match: { company_id: companyId, rfc }, single: true })
          : await query("customers", { match: { company_id: companyId, name: c.name as string }, single: true });
        if (!existing) {
          await insert("customers", { company_id: companyId, name: c.name, rfc, email: (c.email as string) || null });
          syncedCustomers++;
        }
        totalProcessed++;
      }
      await updateSyncLog(logId, { processed_items: totalProcessed, details: { phase: "vendors", customers: syncedCustomers } });
    } catch (e) { errors.push(`Clientes: ${e instanceof Error ? e.message : "error"}`); }

    // Vendors
    try {
      const vendors = await odooFetchAll(url, database, uid, password, "res.partner", [["supplier_rank", ">", 0]], ["id", "name", "vat", "email"]);
      for (const v of vendors) {
        if (!v.name) continue;
        const rfc = (v.vat as string) || null;
        const { data: existing } = rfc
          ? await query("vendors", { match: { company_id: companyId, rfc }, single: true })
          : await query("vendors", { match: { company_id: companyId, name: v.name as string }, single: true });
        if (!existing) {
          await insert("vendors", { company_id: companyId, name: v.name, rfc, email: (v.email as string) || null });
          syncedVendors++;
        }
        totalProcessed++;
      }
      await updateSyncLog(logId, { processed_items: totalProcessed, details: { phase: "invoices", customers: syncedCustomers, vendors: syncedVendors } });
    } catch (e) { errors.push(`Proveedores: ${e instanceof Error ? e.message : "error"}`); }

    // Invoices
    try {
      const invoices = await odooFetchAll(url, database, uid, password, "account.move",
        [["move_type", "in", ["out_invoice", "in_invoice"]]],
        ["id", "name", "partner_id", "move_type", "amount_total", "amount_residual", "invoice_date", "invoice_date_due", "state", "l10n_mx_edi_cfdi_uuid"]);
      for (const inv of invoices) {
        const cfdiUuid = (inv.l10n_mx_edi_cfdi_uuid as string) || null;
        const odooRef = (inv.name as string) || `ODOO-${inv.id}`;
        const partnerName = Array.isArray(inv.partner_id) ? (inv.partner_id[1] as string) : (inv.partner_id as string) || "";
        let existing = null;
        if (cfdiUuid) {
          const q = await query("invoices", { match: { company_id: companyId, cfdi_uuid: cfdiUuid }, single: true });
          existing = q.data;
        }
        if (!existing) {
          const q = await query("invoices", { match: { company_id: companyId, name: odooRef }, single: true });
          existing = q.data;
        }
        if (!existing) {
          await insert("invoices", {
            company_id: companyId, name: odooRef,
            type: inv.move_type === "out_invoice" ? "receivable" : "payable",
            partner_name: partnerName,
            amount_total: Number(inv.amount_total) || 0,
            amount_residual: Number(inv.amount_residual) || 0,
            date_invoice: (inv.invoice_date as string) || null,
            date_due: (inv.invoice_date_due as string) || null,
            status: inv.state === "posted" ? "open" : inv.state === "cancel" ? "cancelled" : "draft",
            cfdi_uuid: cfdiUuid,
          });
          syncedInvoices++;
        } else {
          await update("invoices", {
            amount_total: Number(inv.amount_total) || (existing as Record<string, unknown>).amount_total,
            amount_residual: Number(inv.amount_residual) ?? (existing as Record<string, unknown>).amount_residual,
            status: inv.state === "posted" ? "open" : inv.state === "cancel" ? "cancelled" : (existing as Record<string, unknown>).status,
            cfdi_uuid: cfdiUuid || (existing as Record<string, unknown>).cfdi_uuid,
          }, { id: (existing as Record<string, unknown>).id });
          updatedInvoices++;
        }
        totalProcessed++;
      }
      await updateSyncLog(logId, { processed_items: totalProcessed, details: { phase: "payments", customers: syncedCustomers, vendors: syncedVendors, invoices: syncedInvoices, updated: updatedInvoices } });
    } catch (e) { errors.push(`Facturas: ${e instanceof Error ? e.message : "error"}`); }

    // Payments
    try {
      const payments = await odooFetchAll(url, database, uid, password, "account.payment",
        [["state", "in", ["posted", "sent", "reconciled"]]],
        ["id", "name", "partner_id", "amount", "payment_type", "date", "ref", "currency_id"]);
      for (const p of payments) {
        const ref = (p.ref as string) || (p.name as string) || `ODOO-PAY-${p.id}`;
        const { data: existing } = await query("payments", { match: { company_id: companyId, reference_id: ref }, single: true });
        if (!existing) {
          const partnerName = Array.isArray(p.partner_id) ? (p.partner_id[1] as string) : "";
          const currencyName = Array.isArray(p.currency_id) ? (p.currency_id[1] as string) : "MXN";
          await insert("payments", {
            company_id: companyId, direction: p.payment_type === "inbound" ? "inbound" : "outbound",
            status: "confirmed", amount: Math.abs(Number(p.amount) || 0), currency: currencyName,
            reference_id: ref, partner_name: partnerName, executed_at: (p.date as string) || new Date().toISOString(),
          });
          syncedPayments++;
        }
        totalProcessed++;
      }
    } catch (e) { errors.push(`Pagos: ${e instanceof Error ? e.message : "error"}`); }

    const syncMsg = `Clientes: +${syncedCustomers}, Proveedores: +${syncedVendors}, Facturas: +${syncedInvoices} (${updatedInvoices} act.), Pagos: +${syncedPayments}${errors.length ? ` | Errores: ${errors.join("; ")}` : ""}`;
    const status = errors.length ? "partial" : "success";

    await update("integrations", {
      is_connected: true, last_sync_at: new Date().toISOString(),
      last_sync_status: status, last_sync_message: syncMsg, updated_at: new Date().toISOString(),
    }, { company_id: companyId, provider: "odoo" });

    await completeSyncLog(logId, status, totalProcessed, {
      customers: syncedCustomers, vendors: syncedVendors, invoices: syncedInvoices, updated: updatedInvoices, payments: syncedPayments,
    }, errors.length ? errors.join("; ") : undefined);

    return NextResponse.json({
      success: true, message: "Sincronizacion completada",
      synced: { customers: syncedCustomers, vendors: syncedVendors, invoices: syncedInvoices, updated: updatedInvoices, payments: syncedPayments },
      sync_log_id: logId,
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    await update("integrations", { last_sync_status: "error", last_sync_message: msg, last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { company_id: companyId, provider: "odoo" }).catch(() => {});
    await completeSyncLog(logId, "error", 0, {}, msg);
    return NextResponse.json({ success: false, message: `Error en sincronizacion: ${msg}`, sync_log_id: logId });
  }
}

// ── Fintoc: Test ──

async function testFintoc(companyId: number, config: Record<string, string>) {
  const { secretKey } = config;
  if (!secretKey) {
    return NextResponse.json({ success: false, message: "Falta la Secret Key de Fintoc" });
  }
  try {
    const accounts = await fintocGet("/accounts", secretKey) as unknown[];
    const count = Array.isArray(accounts) ? accounts.length : 0;
    await update("integrations", {
      is_connected: true, last_sync_status: "connected",
      last_sync_message: `API key valida — ${count} cuenta(s) encontrada(s)`,
      updated_at: new Date().toISOString(),
    }, { company_id: companyId, provider: "fintoc" });
    return NextResponse.json({ success: true, message: `Conexion a Fintoc exitosa — ${count} cuenta(s)` });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    await update("integrations", { is_connected: false, last_sync_status: "error", last_sync_message: msg, updated_at: new Date().toISOString() }, { company_id: companyId, provider: "fintoc" }).catch(() => {});
    return NextResponse.json({ success: false, message: msg });
  }
}

// ── Fintoc: Full sync (with sync_logs tracking) ──

async function syncFintoc(companyId: number, config: Record<string, string>) {
  const { secretKey, linkToken } = config;
  if (!secretKey) {
    return NextResponse.json({ success: false, message: "Falta la Secret Key de Fintoc" });
  }

  const logId = await createSyncLog(companyId, "fintoc", "full");
  const errors: string[] = [];
  let totalAccounts = 0, totalMovements = 0, newPayments = 0, totalInvoices = 0;
  let totalProcessed = 0;
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  try {
    const accounts = await fintocGet("/accounts", secretKey) as Array<Record<string, unknown>>;
    totalAccounts = Array.isArray(accounts) ? accounts.length : 0;
    await updateSyncLog(logId, { details: { phase: "movements", accounts: totalAccounts } });

    for (const account of (Array.isArray(accounts) ? accounts : [])) {
      const accountId = account.id as string;
      if (!accountId) continue;
      try {
        const movements = await fintocGet(`/accounts/${accountId}/movements`, secretKey, { since }) as Array<Record<string, unknown>>;
        if (!Array.isArray(movements)) continue;
        totalMovements += movements.length;

        for (const mov of movements) {
          const fintocId = (mov.id as string) || (mov.transaction_id as string);
          if (!fintocId) continue;
          const { data: existing } = await query("payments", { match: { company_id: companyId, fintoc_transfer_id: fintocId }, single: true });
          if (!existing) {
            const amount = Number(mov.amount) || 0;
            await insert("payments", {
              company_id: companyId, direction: amount >= 0 ? "inbound" : "outbound",
              status: "confirmed", amount: Math.abs(amount), currency: (mov.currency as string) || "MXN",
              reference_id: (mov.reference_id as string) || (mov.description as string) || null,
              partner_name: (mov.counterpart as Record<string, unknown>)?.name as string || (mov.description as string) || null,
              fintoc_transfer_id: fintocId, executed_at: (mov.post_date as string) || (mov.created_at as string) || new Date().toISOString(),
            });
            newPayments++;
          }
          totalProcessed++;
        }
        await updateSyncLog(logId, { processed_items: totalProcessed, total_items: totalMovements, details: { phase: "movements", accounts: totalAccounts, movements: totalMovements, new_payments: newPayments } });
      } catch { errors.push(`Movimientos cuenta ${accountId}: error`); }
    }

    // Fiscal invoices
    if (linkToken) {
      try {
        await updateSyncLog(logId, { details: { phase: "invoices", accounts: totalAccounts, movements: totalMovements, new_payments: newPayments } });
        const invoices = await fintocGet("/invoices", secretKey, { link_token: linkToken }) as Array<Record<string, unknown>>;
        if (Array.isArray(invoices)) {
          totalInvoices = invoices.length;
          for (const inv of invoices) {
            const invId = inv.id as string;
            if (!invId) continue;
            const issuer = inv.issuer as Record<string, unknown> | null;
            const receiver = inv.receiver as Record<string, unknown> | null;
            const issueType = inv.issue_type as string;
            const totalAmount = Number(inv.total_amount) || 0;
            const cfdiUuid = (inv.institution_id as string) || invId;
            const { data: existing } = await query("invoices", { match: { company_id: companyId, cfdi_uuid: cfdiUuid }, single: true });
            if (!existing) {
              await insert("invoices", {
                company_id: companyId, name: (inv.number as string) || cfdiUuid,
                type: issueType === "issued" ? "receivable" : "payable",
                partner_name: issueType === "issued" ? (receiver?.name as string) || "" : (issuer?.name as string) || "",
                amount_total: totalAmount / 100, amount_residual: totalAmount / 100,
                date_invoice: (inv.date as string) || null, status: "open", cfdi_uuid: cfdiUuid, source: "fintoc_fiscal",
              });
            }
            totalProcessed++;
          }
        }
      } catch (e) { errors.push(`Facturas fiscales: ${e instanceof Error ? e.message : "error"}`); }
    }

    const syncMsg = `${totalAccounts} cuentas, ${totalMovements} movimientos (${newPayments} nuevos)${totalInvoices > 0 ? `, ${totalInvoices} facturas fiscales` : ""}${errors.length ? ` | ${errors.join("; ")}` : ""}`;
    const status = errors.length ? "partial" : "success";

    await update("integrations", {
      is_connected: true, last_sync_at: new Date().toISOString(),
      last_sync_status: status, last_sync_message: syncMsg, updated_at: new Date().toISOString(),
    }, { company_id: companyId, provider: "fintoc" });

    await completeSyncLog(logId, status, totalProcessed, {
      accounts: totalAccounts, movements: totalMovements, new_payments: newPayments, invoices: totalInvoices,
    }, errors.length ? errors.join("; ") : undefined);

    return NextResponse.json({
      success: true, message: "Sincronizacion de Fintoc completada",
      synced: { accounts: totalAccounts, movements: totalMovements, new_payments: newPayments, invoices: totalInvoices },
      sync_log_id: logId,
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    await update("integrations", { last_sync_status: "error", last_sync_message: msg, last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { company_id: companyId, provider: "fintoc" }).catch(() => {});
    await completeSyncLog(logId, "error", 0, {}, msg);
    return NextResponse.json({ success: false, message: `Error: ${msg}`, sync_log_id: logId });
  }
}

// ── SAT: Test ──

async function testSat(companyId: number, config: Record<string, string>) {
  const { rfcEmisor } = config;
  if (!rfcEmisor) return NextResponse.json({ success: false, message: "Falta el RFC del emisor" });

  const rfcRegex = /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/;
  if (!rfcRegex.test(rfcEmisor)) return NextResponse.json({ success: false, message: "Formato de RFC invalido" });

  // Check if certificates are uploaded
  const { data: existing } = await query("integrations", { match: { company_id: companyId, provider: "sat" }, single: true });
  const cfg = (existing?.config as Record<string, string>) || {};
  const hasCert = !!cfg.certBase64;
  const hasKey = !!cfg.keyBase64;

  const reachable = await testSatReachability(rfcEmisor);
  const certInfo = hasCert && hasKey ? " | Certificados: cargados" : hasCert ? " | Solo .cer cargado" : hasKey ? " | Solo .key cargado" : " | Sin certificados";

  await update("integrations", {
    is_connected: true, last_sync_status: reachable ? "configured" : "warning",
    last_sync_message: reachable
      ? `RFC: ${rfcEmisor} — Servicio SAT verificado${certInfo}`
      : `RFC: ${rfcEmisor} — SAT no responde${certInfo}`,
    updated_at: new Date().toISOString(),
  }, { company_id: companyId, provider: "sat" }).catch(() => {});

  return NextResponse.json({
    success: true,
    message: reachable
      ? `RFC ${rfcEmisor} configurado — servicio SAT verificado${certInfo}`
      : `RFC ${rfcEmisor} configurado — SAT temporalmente no disponible${certInfo}`,
    certificates: { cer: hasCert, key: hasKey },
  });
}

// ── SAT: Sync (with sync_logs tracking) ──

async function syncSat(companyId: number, config: Record<string, string>) {
  const { rfcEmisor } = config;
  if (!rfcEmisor) return NextResponse.json({ success: false, message: "Configuracion SAT incompleta (falta RFC)" });

  try {
    const { data: invoices } = await query("invoices", { match: { company_id: companyId } });
    const withCfdi = (invoices || []).filter((inv: Record<string, unknown>) => inv.cfdi_uuid);

    const logId = await createSyncLog(companyId, "sat", "revalidate", withCfdi.length);
    let validated = 0, vigentes = 0, cancelados = 0, errorsCount = 0;

    for (const inv of withCfdi) {
      try {
        const uuid = inv.cfdi_uuid as string;
        const total = String(Number(inv.amount_total) || 0);
        const satStatus = await validateCfdiAgainstSat(uuid, rfcEmisor, rfcEmisor, total);
        await update("invoices", { sat_status: satStatus }, { id: inv.id });
        validated++;
        if (satStatus === "Vigente") vigentes++;
        else if (satStatus === "Cancelado") cancelados++;
      } catch { errorsCount++; }

      // Update progress after each validation
      await updateSyncLog(logId, {
        processed_items: validated + errorsCount,
        details: { validated, vigentes, cancelados, errors: errorsCount },
      });
    }

    const syncMsg = `${validated} validados: ${vigentes} vigentes, ${cancelados} cancelados${errorsCount > 0 ? `, ${errorsCount} errores` : ""}`;
    const status = errorsCount > 0 ? "partial" : "success";

    await update("integrations", {
      is_connected: true, last_sync_at: new Date().toISOString(),
      last_sync_status: status, last_sync_message: syncMsg, updated_at: new Date().toISOString(),
    }, { company_id: companyId, provider: "sat" });

    await completeSyncLog(logId, status, validated + errorsCount, {
      total_cfdis: withCfdi.length, validated, vigentes, cancelados, errors: errorsCount,
    }, errorsCount > 0 ? `${errorsCount} errores de validacion` : undefined);

    return NextResponse.json({
      success: true, message: `Validacion SAT completada: ${syncMsg}`,
      validated, vigentes, cancelados, errors: errorsCount,
      sync_log_id: logId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    return NextResponse.json({ success: false, message: `Error en validacion SAT: ${msg}` });
  }
}
