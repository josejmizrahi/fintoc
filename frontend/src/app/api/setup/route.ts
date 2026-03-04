import { NextResponse } from "next/server";
import { SCHEMA_SQL, seedDB, hasDB } from "@/lib/db";
import { createClient } from "@supabase/supabase-js";

export async function POST() {
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
    // Use the SQL editor via management API or direct connection
    // For table creation, we return the SQL to run in the Supabase SQL Editor
    // and then seed data via the client
    const seedResult = await seedDB(1);
    return NextResponse.json({
      success: true,
      message: "Datos sembrados correctamente",
      ...seedResult,
      note: "Si las tablas no existen, ejecuta el SQL del endpoint GET /api/setup en el SQL Editor de Supabase",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message, hint: "Asegúrate de crear las tablas primero con el SQL del endpoint GET /api/setup" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    has_database: hasDB(),
    instructions: hasDB()
      ? "Base de datos configurada. Copia el SQL de abajo y ejecútalo en el SQL Editor de Supabase, luego llama POST /api/setup para sembrar datos."
      : "No hay base de datos. Configura NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.",
    schema_sql: SCHEMA_SQL,
  });
}
