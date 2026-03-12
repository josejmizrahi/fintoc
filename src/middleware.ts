import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

// Routes that don't require authentication
const PUBLIC_ROUTES = ["/login", "/api/auth/login", "/api/auth/register", "/api/auth/refresh", "/api/auth/logout", "/api/auth/reset-password", "/api/health", "/api/setup", "/api/webhooks", "/api/cron"];

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

  // For API routes — validate token server-side
  if (pathname.startsWith("/api/")) {
    // 1. Try httpOnly cookie (primary)
    const cookieToken = req.cookies.get("qb_access_token")?.value;
    // 2. Fallback to Bearer header (cron jobs, external clients)
    const authHeader = req.headers.get("authorization");
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

    const token = cookieToken || bearerToken;

    if (!token) {
      return NextResponse.json({ detail: "No autorizado" }, { status: 401 });
    }

    try {
      const admin = getAdminClient();
      const { error } = await admin.auth.getUser(token);
      if (error) {
        return NextResponse.json({ detail: "Token invalido o expirado" }, { status: 401 });
      }
    } catch {
      // Supabase not configured or error — allow through (dev mode)
      return NextResponse.next();
    }

    return NextResponse.next();
  }

  // For dashboard pages — server-side redirect if no auth cookie
  const hasToken = req.cookies.has("qb_access_token");
  if (!hasToken && pathname !== "/login") {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

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
