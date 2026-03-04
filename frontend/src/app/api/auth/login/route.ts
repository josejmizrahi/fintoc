import { NextRequest, NextResponse } from "next/server";
import { findUserByEmail, createToken } from "@/lib/auth-server";

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

    const user = await findUserByEmail(email);
    if (!user || user.password !== password) {
      return NextResponse.json(
        { detail: "Credenciales inválidas" },
        { status: 401 }
      );
    }

    const token = await createToken({
      sub: String(user.id),
      email: user.email,
      name: user.name,
      role: user.role,
      company_id: String(user.company_id),
      company_name: user.company_name,
      company_rfc: user.company_rfc,
    });

    return NextResponse.json({
      access_token: token,
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
  } catch {
    return NextResponse.json(
      { detail: "Error al iniciar sesión" },
      { status: 500 }
    );
  }
}
