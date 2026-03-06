import { NextRequest, NextResponse } from "next/server";
import { hasDB, query, update } from "@/lib/db";
import { getCompanyId } from "@/lib/auth-helpers";
import {
  createTransfer,
  verifyCLABE,
  createAccountNumber,
  getAccountNumber,
} from "@/lib/integrations/fintoc";

/**
 * POST /api/fintoc
 * Handles Fintoc operations:
 * - action: "outbound-transfer" — Send SPEI payment
 * - action: "verify-clabe" — Verify CLABE ownership via micro-deposit
 * - action: "create-account-number" — Create dedicated CLABE for customer
 * - action: "get-account-number" — Get account number details
 */
export async function POST(req: NextRequest) {
  const companyId = await getCompanyId(req);
  if (!companyId) return NextResponse.json({ detail: "No autorizado" }, { status: 401 });
  if (!hasDB()) return NextResponse.json({ detail: "DB no configurada" }, { status: 500 });

  const body = await req.json();
  const { action } = body as { action: string };

  // Load Fintoc integration config
  const { data: integration } = await query("integrations", {
    match: { company_id: companyId, provider: "fintoc" },
    single: true,
  });
  const config = (integration?.config || {}) as Record<string, string>;
  const secretKey = config.secretKey;

  if (!secretKey || secretKey === "••••••••") {
    return NextResponse.json({
      success: false,
      message: "Fintoc no esta configurado. Agrega tu Secret Key en Configuracion.",
    }, { status: 400 });
  }

  switch (action) {
    // ── Outbound Transfer (SPEI) via /transfers ──
    case "outbound-transfer": {
      const { payment_id, clabe, amount, holder_name, reference_id, metadata } = body as {
        payment_id?: number;
        clabe: string;
        amount: number;
        holder_name?: string;
        reference_id?: string;
        metadata?: Record<string, string>;
      };

      if (!clabe || !amount) {
        return NextResponse.json({ success: false, message: "CLABE y monto son requeridos" }, { status: 400 });
      }
      if (!/^\d{18}$/.test(clabe)) {
        return NextResponse.json({ success: false, message: "CLABE debe tener 18 digitos" }, { status: 400 });
      }

      const amountCents = Math.round(amount * 100);
      const concept = reference_id || (payment_id ? `PAY-${payment_id}` : `Pago`);
      try {
        const transfer = await createTransfer(
          {
            amount: amountCents,
            currency: "MXN",
            destination_account: { number: clabe },
            concept,
            reference_id: reference_id || (payment_id ? `PAY-${payment_id}` : undefined),
            metadata: {
              company_id: String(companyId),
              ...(payment_id ? { payment_id: String(payment_id) } : {}),
              ...metadata,
            },
          },
          secretKey,
          payment_id ? `pay-${payment_id}` : undefined
        );

        if (payment_id) {
          await update("payments", {
            status: "processing",
            fintoc_transfer_id: transfer.id,
            updated_at: new Date().toISOString(),
          }, { id: payment_id, company_id: companyId });
        }

        return NextResponse.json({
          success: true,
          message: "Transferencia SPEI enviada",
          transfer_id: transfer.id,
          status: transfer.status,
        });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Error al enviar transferencia SPEI";
        return NextResponse.json({ success: false, message });
      }
    }

    // ── CLABE Verification (micro-deposit) ──
    case "verify-clabe": {
      const { vendor_id, clabe } = body as { vendor_id?: number; clabe: string };

      if (!clabe || !/^\d{18}$/.test(clabe)) {
        return NextResponse.json({ success: false, message: "CLABE invalida (18 digitos requeridos)" }, { status: 400 });
      }

      try {
        const data = await verifyCLABE(clabe, secretKey) as { holder_name?: string; account_holder?: string; institution?: { name?: string } };
        const holderName = data?.holder_name ?? data?.account_holder ?? null;
        const bankName = data?.institution?.name ?? null;

        if (vendor_id && holderName) {
          await update("vendors", {
            clabe_verified: true,
            clabe_holder_name: holderName,
          }, { id: vendor_id, company_id: companyId });
        }

        return NextResponse.json({
          success: true,
          message: "CLABE verificada exitosamente",
          holder_name: holderName,
          bank: bankName,
          verified: true,
        });
      } catch (e: unknown) {
        return NextResponse.json({
          success: false,
          message: e instanceof Error ? e.message : "Error al verificar CLABE",
        });
      }
    }

    // ── Create Account Number (dedicated CLABE for customer) ──
    case "create-account-number": {
      const { customer_id } = body as { customer_id: number };
      if (!customer_id) {
        return NextResponse.json({ success: false, message: "customer_id requerido" }, { status: 400 });
      }

      const { data: customer } = await query("customers", {
        match: { id: customer_id, company_id: companyId },
        single: true,
      });
      if (!customer) {
        return NextResponse.json({ success: false, message: "Cliente no encontrado" }, { status: 404 });
      }

      const cust = customer as Record<string, unknown>;
      if (cust.fintoc_account_number_id) {
        return NextResponse.json({
          success: true,
          message: "El cliente ya tiene una CLABE dedicada",
          clabe: cust.fintoc_clabe,
          account_number_id: cust.fintoc_account_number_id,
        });
      }

      try {
        const result = await createAccountNumber(
          (cust.name as string) || "",
          `CLABE dedicada cliente ${customer_id}`,
          undefined,
          secretKey,
          {
            company_id: String(companyId),
            customer_id: String(customer_id),
            customer_name: (cust.name as string) || "",
          }
        );

        await update("customers", {
          fintoc_account_number_id: result.id,
          fintoc_clabe: result.number,
        }, { id: customer_id, company_id: companyId });

        return NextResponse.json({
          success: true,
          message: "CLABE dedicada creada para el cliente",
          account_number_id: result.id,
          clabe: result.number,
        });
      } catch (e: unknown) {
        return NextResponse.json({
          success: false,
          message: e instanceof Error ? e.message : "Error al crear CLABE dedicada",
        });
      }
    }

    // ── Get Account Number details ──
    case "get-account-number": {
      const { account_number_id } = body as { account_number_id: string };
      if (!account_number_id) {
        return NextResponse.json({ success: false, message: "account_number_id requerido" }, { status: 400 });
      }

      try {
        const data = await getAccountNumber(account_number_id, secretKey);
        return NextResponse.json({ success: true, data });
      } catch (e: unknown) {
        return NextResponse.json({ success: false, message: e instanceof Error ? e.message : "Error" });
      }
    }

    default:
      return NextResponse.json({ detail: "Accion invalida" }, { status: 400 });
  }
}
