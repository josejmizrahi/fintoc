import { NextResponse } from "next/server";

// Middleware is intentionally a no-op passthrough.
// All auth validation is handled by withAuth() in route handlers,
// which uses the admin client (service role key) to validate tokens
// and check user_companies membership. This avoids double-validation
// and the associated race conditions / error cascading.
export function middleware() {
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Only match API routes — page routes don't need middleware
    "/api/:path*",
  ],
};
