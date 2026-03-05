import { NextRequest, NextResponse } from "next/server";
import { hasDB, query } from "@/lib/db";
import { getCompanyId } from "@/lib/auth-helpers";

/**
 * GET /api/sync-logs?provider=odoo&limit=10
 * Returns sync log history for the company, optionally filtered by provider.
 */
export async function GET(req: NextRequest) {
  const companyId = await getCompanyId(req);
  if (!companyId) return NextResponse.json({ detail: "No autorizado" }, { status: 401 });
  if (!hasDB()) return NextResponse.json({ logs: [] });

  const provider = req.nextUrl.searchParams.get("provider");
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 20, 100);

  const match: Record<string, unknown> = { company_id: companyId };
  if (provider) match.provider = provider;

  const { data: logs } = await query("sync_logs", {
    match,
    order: { column: "started_at", ascending: false },
    limit,
  });

  return NextResponse.json({ logs: logs || [] });
}
