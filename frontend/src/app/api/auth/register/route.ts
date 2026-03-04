import { NextRequest, NextResponse } from "next/server";
import { registerUser } from "@/lib/auth-server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password, name, company_name, rfc } = body;

    if (!email || !password || !name || !company_name || !rfc) {
      return NextResponse.json(
        { detail: "Todos los campos son obligatorios" },
        { status: 400 }
      );
    }
    if (password.length < 6) {
      return NextResponse.json(
        { detail: "La contraseña debe tener al menos 6 caracteres" },
        { status: 400 }
      );
    }

    const user = await registerUser(
      email.toLowerCase().trim(),
      password,
      name,
      company_name,
      rfc.toUpperCase()
    );

    return NextResponse.json(
      {
        access_token: user.access_token,
        token_type: "bearer",
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        tenant: {
          id: String(user.company_id),
          name: user.company_name,
          rfc: user.company_rfc,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al registrar";
    return NextResponse.json({ detail: message }, { status: 400 });
  }
}
