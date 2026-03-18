import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { setAuthCookies } from '@/lib/auth-cookies';

/**
 * GET /auth/callback
 *
 * Handles Supabase auth callbacks (password recovery, email confirmation, magic links).
 * Supabase redirects here with ?code=...&type=recovery (or type=signup, type=magiclink).
 * We exchange the code for a session, set httpOnly cookies, and redirect to the appropriate page.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const type = searchParams.get('type');
  const next = searchParams.get('next') || '/';

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;

  if (!code) {
    return NextResponse.redirect(new URL('/login', appUrl));
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.redirect(new URL('/login?error=config', appUrl));
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Exchange the code for a session
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    return NextResponse.redirect(new URL('/login?error=invalid_code', appUrl));
  }

  // Set auth cookies
  const cookies = setAuthCookies(data.session.access_token, data.session.refresh_token);

  // Redirect based on callback type
  let redirectPath = next;
  if (type === 'recovery') {
    redirectPath = '/login?reset=true';
  } else if (type === 'signup') {
    redirectPath = '/onboarding';
  }

  const response = NextResponse.redirect(new URL(redirectPath, appUrl));

  // Apply httpOnly cookies to the redirect response
  for (const cookie of cookies) {
    response.headers.append('Set-Cookie', cookie);
  }

  return response;
}
