import { NextRequest, NextResponse } from "next/server";
import { getCompanyId } from "@/lib/auth-helpers";
import { hasDB, query, update } from "@/lib/db";
import { fintocExchangeSchema } from "@/lib/validations/schemas";

/**
 * POST /api/fintoc/exchange
 * Exchanges a Fintoc Widget exchange_token for a persistent link_token.
 * The link_token is stored in the integrations config for future API calls.
 *
 * Fintoc flow:
 * 1. Frontend opens Fintoc Widget with publicKey
 * 2. User connects bank → Widget returns exchangeToken
 * 3. This endpoint exchanges exchangeToken → link_token via POST /v1/links
 * 4. link_token is saved in integrations.config.linkToken
 */
export async function POST(req: NextRequest) {
  const companyId = await getCompanyId(req);
  if (!companyId) {
    return NextResponse.json({ detail: "No autorizado" }, { status: 401 });
  }
  if (!hasDB()) {
    return NextResponse.json({ detail: "DB no configurada" }, { status: 500 });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ success: false, message: "JSON invalido" }, { status: 400 });
  }

  const parsed = fintocExchangeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, message: parsed.error.issues[0]?.message || "exchange_token es requerido" },
      { status: 400 },
    );
  }

  const exchangeToken = parsed.data.exchange_token;

  // Load Fintoc integration config to get secretKey
  const { data: integration } = await query("integrations", {
    match: { company_id: companyId, provider: "fintoc" },
    single: true,
  });

  const config = ((integration as Record<string, unknown>)?.config || {}) as Record<string, string>;
  const secretKey = config.secretKey;

  if (!secretKey || secretKey === "••••••••") {
    return NextResponse.json(
      { success: false, message: "Fintoc Secret Key no configurada" },
      { status: 400 },
    );
  }

  try {
    // Exchange the token with Fintoc API
    const res = await fetch("https://api.fintoc.com/v1/links", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: secretKey,
      },
      body: JSON.stringify({ exchange_token: exchangeToken }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      let errorMsg = `Fintoc HTTP ${res.status}`;
      try {
        const parsed = JSON.parse(errorBody);
        errorMsg = parsed?.error?.message || errorMsg;
      } catch { /* use default */ }
      return NextResponse.json(
        { success: false, message: errorMsg },
        { status: 502 },
      );
    }

    const linkData = await res.json();
    const linkToken = linkData.link_token || linkData.id;

    if (!linkToken) {
      return NextResponse.json(
        { success: false, message: "No se recibio link_token de Fintoc" },
        { status: 502 },
      );
    }

    // Save link_token in integration config
    const updatedConfig = { ...config, linkToken };
    await update(
      "integrations",
      {
        config: updatedConfig,
        is_connected: true,
        status: "valid",
        updated_at: new Date().toISOString(),
      },
      { company_id: companyId, provider: "fintoc" },
    );

    return NextResponse.json({
      success: true,
      link_token: linkToken,
      message: "Cuenta bancaria conectada exitosamente",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json(
      { success: false, message: `Error al intercambiar token: ${msg}` },
      { status: 502 },
    );
  }
}
