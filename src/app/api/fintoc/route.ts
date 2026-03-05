import { NextRequest, NextResponse } from "next/server";
import { hasDB, query, update, insert } from "@/lib/db";
import { getCompanyId } from "@/lib/auth-helpers";
import {
  fintocOutboundTransfer,
  fintocVerifyClabe,
  fintocCreateAccountNumber,
  fintocGetAccountNumber,
} from "@/lib/fintoc";

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

  const jwsPrivateKey = process.env.FINTOC_JWS_PRIVATE_KEY || "";

  switch (action) {
    // ── Outbound Transfer (SPEI dispersion) ──
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
      if (!jwsPrivateKey) {
        return NextResponse.json({
          success: false,
          message: "JWS private key no configurada. Genera las llaves en el dashboard de Fintoc y configura FINTOC_JWS_PRIVATE_KEY.",
        }, { status: 500 });
      }

      const amountCents = Math.round(amount * 100);
      const result = await fintocOutboundTransfer(secretKey, jwsPrivateKey, {
        amount: amountCents,
        currency: "MXN",
        counterparty: {
          account_type: "CLABE",
          account_number: clabe,
          holder_name: holder_name || undefined,
        },
        reference_id: reference_id || (payment_id ? `PAY-${payment_id}` : `PAY-${Date.now()}`),
        metadata: {
          company_id: String(companyId),
          ...(payment_id ? { payment_id: String(payment_id) } : {}),
          ...metadata,
        },
      });

      if (!result.ok) {
        return NextResponse.json({ success: false, message: result.error || "Error al enviar transferencia SPEI" });
      }

      // Update payment record if we have one
      if (payment_id) {
        await update("payments", {
          status: "processing",
          fintoc_transfer_id: (result.data?.id as string) || null,
          jws_signed: true,
          updated_at: new Date().toISOString(),
        }, { id: payment_id, company_id: companyId });
      }

      return NextResponse.json({
        success: true,
        message: "Transferencia SPEI enviada",
        transfer_id: result.data?.id,
        status: result.data?.status,
      });
    }

    // ── CLABE Verification (micro-deposit) ──
    case "verify-clabe": {
      const { vendor_id, clabe } = body as { vendor_id?: number; clabe: string };

      if (!clabe || !/^\d{18}$/.test(clabe)) {
        return NextResponse.json({ success: false, message: "CLABE invalida (18 digitos requeridos)" }, { status: 400 });
      }
      if (!jwsPrivateKey) {
        return NextResponse.json({
          success: false,
          message: "JWS private key no configurada para verificacion de CLABE.",
        }, { status: 500 });
      }

      const result = await fintocVerifyClabe(secretKey, jwsPrivateKey, clabe);

      if (!result.ok) {
        return NextResponse.json({ success: false, message: result.error || "Error al verificar CLABE" });
      }

      const holderName = (result.data?.holder_name as string) || (result.data?.account_holder as string) || null;
      const bankName = (result.data?.institution as Record<string, unknown>)?.name as string || null;

      // Update vendor if specified
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

      // Check if already has a dedicated CLABE
      if ((customer as Record<string, unknown>).fintoc_account_number_id) {
        return NextResponse.json({
          success: true,
          message: "El cliente ya tiene una CLABE dedicada",
          clabe: (customer as Record<string, unknown>).fintoc_clabe,
          account_number_id: (customer as Record<string, unknown>).fintoc_account_number_id,
        });
      }

      const result = await fintocCreateAccountNumber(secretKey, {
        company_id: String(companyId),
        customer_id: String(customer_id),
        customer_name: (customer as Record<string, unknown>).name as string || "",
      });

      if (!result.ok) {
        return NextResponse.json({ success: false, message: result.error || "Error al crear CLABE dedicada" });
      }

      const accountNumberId = result.data?.id as string;
      const clabe = result.data?.number as string || result.data?.clabe as string || "";

      // Save to customer record
      await update("customers", {
        fintoc_account_number_id: accountNumberId,
        fintoc_clabe: clabe,
      }, { id: customer_id, company_id: companyId });

      return NextResponse.json({
        success: true,
        message: "CLABE dedicada creada para el cliente",
        account_number_id: accountNumberId,
        clabe,
      });
    }

    // ── Get Account Number details ──
    case "get-account-number": {
      const { account_number_id } = body as { account_number_id: string };
      if (!account_number_id) {
        return NextResponse.json({ success: false, message: "account_number_id requerido" }, { status: 400 });
      }

      try {
        const data = await fintocGetAccountNumber(secretKey, account_number_id);
        return NextResponse.json({ success: true, data });
      } catch (e) {
        return NextResponse.json({ success: false, message: e instanceof Error ? e.message : "Error" });
      }
    }

    default:
      return NextResponse.json({ detail: "Accion invalida" }, { status: 400 });
  }
}
