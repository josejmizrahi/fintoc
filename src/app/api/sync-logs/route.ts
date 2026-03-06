import { NextRequest, NextResponse } from "next/server";
import { hasDB, query } from "@/lib/db";
import { getCompanyId } from "@/lib/auth-helpers";

/**
 * GET /api/sync-logs?provider=odoo&limit=10
 * Returns sync history for the company (from sync_history table), optionally filtered by provider.
 */
export async function GET(req: NextRequest) {
  const companyId = await getCompanyId(req);
  if (!companyId) return NextResponse.json({ detail: "No autorizado" }, { status: 401 });
  if (!hasDB()) return NextResponse.json({ logs: [] });

  const url = new URL(req.url);
  const provider = url.searchParams.get("provider");
  const limit = Math.min(Number(url.searchParams.get("limit")) || 20, 100);

  const match: Record<string, unknown> = { company_id: companyId };
  if (provider) match.provider = provider;

  const { data: logs } = await query("sync_history", {
    match,
    order: { column: "started_at", ascending: false },
    limit,
  });

  return NextResponse.json({ logs: logs || [] });
}
