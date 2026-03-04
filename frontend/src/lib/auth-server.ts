import { createClient } from "@supabase/supabase-js";
import { hasDB, query, insert, seedDB } from "./db";

// Server-side Supabase client (service role for admin operations like creating companies)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function getAdminClient() {
  if (!supabaseUrl || !supabaseServiceKey) return null;
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface JWTPayload {
  sub: string;
  email: string;
  name: string;
  role: string;
  company_id: string;
  company_name: string;
  company_rfc: string;
}

// Verify Supabase JWT by calling supabase.auth.getUser with the token
export async function verifyToken(token: string): Promise<JWTPayload | null> {
  const admin = getAdminClient();
  if (!admin) return null;

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;

  const userId = data.user.id;

  // Fetch user profile from our users table
  const { data: profile } = await admin
    .from("users")
    .select("id, email, name, role, company_id")
    .eq("auth_uid", userId)
    .single();

  if (!profile) return null;

  const { data: company } = await admin
    .from("companies")
    .select("name, rfc")
    .eq("id", profile.company_id)
    .single();

  return {
    sub: String(profile.id),
    email: profile.email,
    name: profile.name,
    role: profile.role,
    company_id: String(profile.company_id),
    company_name: company?.name || "",
    company_rfc: company?.rfc || "",
  };
}

export interface StoredUser {
  id: number;
  email: string;
  name: string;
  role: string;
  company_id: number;
  company_name: string;
  company_rfc: string;
  auth_uid: string;
}

export async function registerUser(
  email: string,
  password: string,
  name: string,
  companyName: string,
  rfc: string
): Promise<StoredUser & { access_token: string }> {
  const admin = getAdminClient();
  const normalizedEmail = email.toLowerCase().trim();

  if (!admin || !hasDB()) {
    throw new Error("Base de datos no configurada. Configura Supabase primero.");
  }

  // 1. Create auth user via Supabase Auth (handles hashing, rate limiting)
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: true,
    user_metadata: { name },
  });

  if (authError) {
    if (authError.message.includes("already been registered")) {
      throw new Error("El correo ya está registrado");
    }
    throw new Error(`Error al crear cuenta: ${authError.message}`);
  }

  const authUid = authData.user.id;

  try {
    // 2. Create company
    const { data: companies, error: companyError } = await insert("companies", {
      name: companyName,
      rfc,
    });
    if (companyError) throw new Error(`Error al crear empresa: ${companyError.message}`);
    const companyId = companies?.[0]?.id;
    if (!companyId) throw new Error("Error al crear empresa");

    // 3. Create user profile linked to auth user
    const { data: users, error: userError } = await insert("users", {
      auth_uid: authUid,
      email: normalizedEmail,
      password_hash: "SUPABASE_AUTH",
      name,
      role: "admin",
      company_id: companyId,
    });
    if (userError) throw new Error(`Error al crear usuario: ${userError.message}`);
    if (!users?.[0]) throw new Error("Error al crear usuario");

    // 4. Seed demo data
    await seedDB(companyId);

    // 5. Sign in to get a session token
    const { data: session, error: sessionError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: normalizedEmail,
    });

    // Get a real session by signing in
    const signInClient = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "", {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signInData, error: signInError } = await signInClient.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (signInError || !signInData.session) {
      throw new Error("Cuenta creada pero error al iniciar sesión. Intenta iniciar sesión manualmente.");
    }

    return {
      id: users[0].id,
      email: normalizedEmail,
      name,
      role: "admin",
      company_id: companyId,
      company_name: companyName,
      company_rfc: rfc,
      auth_uid: authUid,
      access_token: signInData.session.access_token,
    };
  } catch (error) {
    // Cleanup: delete auth user if DB operations fail
    await admin.auth.admin.deleteUser(authUid);
    throw error;
  }
}

export async function loginUser(
  email: string,
  password: string
): Promise<StoredUser & { access_token: string }> {
  const normalizedEmail = email.toLowerCase().trim();

  // Sign in via Supabase Auth (handles bcrypt verification, rate limiting)
  const signInClient = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "", {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signInData, error: signInError } = await signInClient.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  });

  if (signInError || !signInData.session) {
    throw new Error("Credenciales inválidas");
  }

  const authUid = signInData.user.id;
  const admin = getAdminClient();
  if (!admin) throw new Error("Error de configuración del servidor");

  // Fetch user profile
  const { data: profile, error: profileError } = await admin
    .from("users")
    .select("id, email, name, role, company_id")
    .eq("auth_uid", authUid)
    .single();

  if (profileError || !profile) {
    throw new Error("Usuario no encontrado en el sistema. Contacta al administrador.");
  }

  const { data: company } = await admin
    .from("companies")
    .select("name, rfc")
    .eq("id", profile.company_id)
    .single();

  return {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    role: profile.role,
    company_id: profile.company_id,
    company_name: company?.name || "",
    company_rfc: company?.rfc || "",
    auth_uid: authUid,
    access_token: signInData.session.access_token,
  };
}
