import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Routes that don't require authentication
const PUBLIC_ROUTES = ["/login", "/api/auth/login", "/api/auth/register", "/api/auth/refresh", "/api/auth/reset-password", "/api/health", "/api/setup", "/api/webhooks", "/api/cron"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Skip public routes, static files, and Next.js internals
  if (
    PUBLIC_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/")) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.match(/\.(ico|png|jpg|svg|css|js|woff2?)$/)
  ) {
    return NextResponse.next();
  }

  // For API routes — validate Bearer token server-side
  if (pathname.startsWith("/api/")) {
    const auth = req.headers.get("authorization");
    if (!auth?.startsWith("Bearer ")) {
      return NextResponse.json({ detail: "No autorizado" }, { status: 401 });
    }

    const token = auth.slice(7);
    if (!supabaseUrl || !supabaseServiceKey) {
      // No Supabase configured — allow through (dev mode)
      return NextResponse.next();
    }

    try {
      const supabase = createClient(supabaseUrl, supabaseServiceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await supabase.auth.getUser(token);
      if (error) {
        return NextResponse.json({ detail: "Token invalido o expirado" }, { status: 401 });
      }
    } catch {
      return NextResponse.json({ detail: "Error de autenticacion" }, { status: 500 });
    }

    return NextResponse.next();
  }

  // For dashboard pages — check for token cookie or redirect
  // Client-side auth store handles the redirect, but we add a server-side check too
  // We can't easily validate the JWT from localStorage here (it's in the browser),
  // so we let the client handle page-level redirects but block API access above
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all API routes except auth
    "/api/:path*",
    // Match dashboard routes (but not static files)
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
