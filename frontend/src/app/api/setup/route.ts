import { NextResponse } from "next/server";
import { seedDB, hasDB } from "@/lib/db";

export async function POST(req: Request) {
  if (!hasDB()) {
    return NextResponse.json(
      {
        error: "No database configured",
        instructions: [
          "1. Crea un proyecto en supabase.com",
          "2. Configura NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en Vercel",
          "3. Redeploy y llama POST /api/setup",
        ],
      },
      { status: 400 }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const companyId = (body as { company_id?: number }).company_id || 1;
    const seedResult = await seedDB(companyId);
    return NextResponse.json({
      success: true,
      ...seedResult,
      note: "Si las tablas no existen, ejecuta las migraciones en supabase/migrations/ en el SQL Editor de Supabase",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    has_database: hasDB(),
    instructions: [
      "1. Ejecuta supabase/migrations/001_initial_schema.sql en el SQL Editor",
      "2. Ejecuta supabase/migrations/002_auth_and_rls.sql en el SQL Editor",
      "3. Llama POST /api/setup para sembrar datos demo",
    ],
  });
}
