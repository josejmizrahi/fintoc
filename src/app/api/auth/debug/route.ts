import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase/admin';

/**
 * Debug endpoint to diagnose auth issues.
 * Tests: token extraction → getUser → user_companies lookup
 * Returns detailed info about what passes/fails.
 */
export async function GET(req: NextRequest) {
  const result: Record<string, unknown> = { timestamp: new Date().toISOString() };

  // Step 1: Extract token
  const auth = req.headers.get('authorization');
  result.has_auth_header = !!auth;
  result.auth_header_prefix = auth?.slice(0, 15) || null;

  if (!auth?.startsWith('Bearer ')) {
    result.error = 'No Bearer token in Authorization header';
    return NextResponse.json(result, { status: 401 });
  }

  const token = auth.slice(7);
  result.token_length = token.length;
  result.token_preview = token.slice(0, 20) + '...';

  // Step 2: Validate token with admin client
  try {
    const admin = getAdminClient();
    result.admin_client = 'ok';

    const { data: { user }, error } = await admin.auth.getUser(token);
    if (error) {
      result.getUser_error = error.message;
      result.getUser_status = error.status;
      return NextResponse.json(result, { status: 401 });
    }

    result.getUser = 'ok';
    result.user_id = user?.id;
    result.user_email = user?.email;

    // Step 3: Check user_companies
    const { data: memberships, error: memberError } = await admin
      .from('user_companies')
      .select('company_id, role, is_active, status')
      .eq('user_id', user!.id);

    if (memberError) {
      result.user_companies_error = memberError.message;
      return NextResponse.json(result, { status: 500 });
    }

    result.user_companies_count = memberships?.length || 0;
    result.user_companies = memberships;

    // Step 4: Check active membership specifically
    const active = memberships?.filter(m => m.is_active && m.status === 'active');
    result.active_memberships = active?.length || 0;

    if (!active || active.length === 0) {
      result.error = 'No active membership found (is_active=true AND status=active)';
      return NextResponse.json(result, { status: 403 });
    }

    result.status = 'all_checks_passed';
    return NextResponse.json(result);
  } catch (err) {
    result.exception = err instanceof Error ? err.message : String(err);
    return NextResponse.json(result, { status: 500 });
  }
}
