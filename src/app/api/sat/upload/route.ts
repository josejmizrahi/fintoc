import { NextRequest, NextResponse } from "next/server";
import { hasDB, query, update } from "@/lib/db";
import { getCompanyId } from "@/lib/auth-helpers";

/**
 * POST /api/sat/upload
 * Accepts .cer and .key files as multipart/form-data.
 * Stores file content as base64 in integrations.config JSONB.
 */
export async function POST(req: NextRequest) {
  const companyId = await getCompanyId(req);
  if (!companyId) return NextResponse.json({ detail: "No autorizado" }, { status: 401 });
  if (!hasDB()) return NextResponse.json({ detail: "DB no configurada" }, { status: 500 });

  const formData = await req.formData();
  const cerFile = formData.get("cer") as File | null;
  const keyFile = formData.get("key") as File | null;
  const keyPassword = formData.get("keyPassword") as string | null;
  const rfcEmisor = formData.get("rfcEmisor") as string | null;

  if (!cerFile && !keyFile) {
    return NextResponse.json({ detail: "Se requiere al menos un archivo (.cer o .key)" }, { status: 400 });
  }

  // Validate file types
  if (cerFile) {
    const name = cerFile.name.toLowerCase();
    if (!name.endsWith(".cer")) {
      return NextResponse.json({ detail: "El archivo de certificado debe tener extension .cer" }, { status: 400 });
    }
    if (cerFile.size > 10 * 1024) {
      return NextResponse.json({ detail: "El archivo .cer no debe exceder 10KB" }, { status: 400 });
    }
  }

  if (keyFile) {
    const name = keyFile.name.toLowerCase();
    if (!name.endsWith(".key")) {
      return NextResponse.json({ detail: "El archivo de llave debe tener extension .key" }, { status: 400 });
    }
    if (keyFile.size > 10 * 1024) {
      return NextResponse.json({ detail: "El archivo .key no debe exceder 10KB" }, { status: 400 });
    }
  }

  try {
    // Read file contents as base64
    const updates: Record<string, string> = {};

    if (cerFile) {
      const cerBuffer = await cerFile.arrayBuffer();
      updates.certBase64 = Buffer.from(cerBuffer).toString("base64");
      updates.certFileName = cerFile.name;
    }

    if (keyFile) {
      const keyBuffer = await keyFile.arrayBuffer();
      updates.keyBase64 = Buffer.from(keyBuffer).toString("base64");
      updates.keyFileName = keyFile.name;
    }

    if (keyPassword) {
      updates.keyPassword = keyPassword;
    }

    if (rfcEmisor) {
      updates.rfcEmisor = rfcEmisor;
    }

    // Get or create SAT integration record
    const { data: existing } = await query("integrations", {
      match: { company_id: companyId, provider: "sat" },
      single: true,
    });

    const existingConfig = (existing?.config as Record<string, string>) || {};
    const mergedConfig = { ...existingConfig, ...updates };

    if (existing) {
      await update(
        "integrations",
        {
          config: mergedConfig,
          cert_uploaded_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { company_id: companyId, provider: "sat" },
      );
    } else {
      const { insert: dbInsert } = await import("@/lib/db");
      await dbInsert("integrations", {
        company_id: companyId,
        provider: "sat",
        config: mergedConfig,
        cert_uploaded_at: new Date().toISOString(),
      });
    }

    const uploadedFiles = [];
    if (cerFile) uploadedFiles.push(cerFile.name);
    if (keyFile) uploadedFiles.push(keyFile.name);

    return NextResponse.json({
      success: true,
      message: `Archivos subidos: ${uploadedFiles.join(", ")}`,
      files: {
        cer: cerFile ? { name: cerFile.name, size: cerFile.size } : null,
        key: keyFile ? { name: keyFile.name, size: keyFile.size } : null,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    return NextResponse.json({ success: false, message: `Error al subir archivos: ${msg}` }, { status: 500 });
  }
}
