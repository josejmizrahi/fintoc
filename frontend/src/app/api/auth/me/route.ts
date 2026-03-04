import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth-server";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ detail: "No autenticado" }, { status: 401 });
  }

  const payload = await verifyToken(auth.slice(7));
  if (!payload) {
    return NextResponse.json({ detail: "Token inválido" }, { status: 401 });
  }

  return NextResponse.json({
    id: Number(payload.sub),
    email: payload.email,
    name: payload.name,
    role: payload.role,
    company_id: Number(payload.company_id),
    company_name: payload.company_name,
    company_rfc: payload.company_rfc,
  });
}
