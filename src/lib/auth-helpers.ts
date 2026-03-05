/**
 * Shared auth helpers for API routes
 * Extracts company_id from JWT via Supabase Auth + user_companies table
 */

import { NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export async function getCompanyId(req: NextRequest): Promise<number | null> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);

  const admin = getAdminClient();
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return null;

  const { data: membership } = await admin
    .from("user_companies")
    .select("company_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .eq("status", "active")
    .single();

  return membership ? Number(membership.company_id) : null;
}

export async function getUserRole(req: NextRequest): Promise<string | null> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);

  const admin = getAdminClient();
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return null;

  const { data: membership } = await admin
    .from("user_companies")
    .select("role")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .eq("status", "active")
    .single();

  return membership?.role || null;
}

/** Config masking — hide sensitive fields before sending to frontend */
const SENSITIVE_KEYS = new Set([
  "password",
  "secretKey",
  "webhookSecret",
  "keyPassword",
  "smtpPassword",
]);
const MASK = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";

export function maskConfig(
  config: Record<string, string> | null | undefined,
): Record<string, string> | null {
  if (!config || typeof config !== "object") return null;
  const masked: Record<string, string> = {};
  for (const [key, val] of Object.entries(config)) {
    masked[key] = SENSITIVE_KEYS.has(key) && val ? MASK : val;
  }
  return masked;
}

export function resolveConfig(
  frontendConfig: Record<string, string> | undefined,
  savedConfig: Record<string, unknown> | undefined,
): Record<string, string> {
  if (!frontendConfig)
    return (savedConfig as Record<string, string>) || {};
  if (!savedConfig || typeof savedConfig !== "object") return frontendConfig;
  const resolved = { ...frontendConfig };
  for (const key of Object.keys(resolved)) {
    if (resolved[key] === MASK || resolved[key] === "••••••••") {
      resolved[key] = (savedConfig as Record<string, string>)[key] || "";
    }
  }
  return resolved;
}
