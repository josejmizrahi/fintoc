import { NextResponse } from "next/server";
import { initDB, seedDB, hasDB } from "@/lib/db";

export async function POST() {
  if (!hasDB()) {
    return NextResponse.json(
      {
        error: "No database configured",
        instructions: [
          "1. Ve a tu dashboard de Vercel → Storage → Create Database → Postgres",
          "2. Vincula la base de datos a tu proyecto",
          "3. Las variables POSTGRES_URL se configuran automáticamente",
          "4. Haz redeploy del proyecto",
          "5. Llama a POST /api/setup de nuevo para crear las tablas",
        ],
      },
      { status: 400 }
    );
  }

  try {
    await initDB();
    // Seed with company_id=1 as default demo data
    const seedResult = await seedDB(1);
    return NextResponse.json({
      success: true,
      message: "Base de datos inicializada correctamente",
      ...seedResult,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    has_database: hasDB(),
    instructions: hasDB()
      ? "Base de datos configurada. Usa POST /api/setup para inicializar tablas."
      : "No hay base de datos. Configura Vercel Postgres en tu dashboard de Vercel.",
  });
}
