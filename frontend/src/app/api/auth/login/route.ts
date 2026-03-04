import { NextRequest, NextResponse } from "next/server";
import { loginUser } from "@/lib/auth-server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { detail: "Correo y contraseña son obligatorios" },
        { status: 400 }
      );
    }

    const user = await loginUser(email, password);

    return NextResponse.json({
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
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al iniciar sesión";
    const status = message.includes("inválidas") ? 401 : 500;
    return NextResponse.json({ detail: message }, { status });
  }
}
