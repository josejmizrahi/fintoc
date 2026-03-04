import { createClient } from "@supabase/supabase-js";
import { hasDB, query, insert, seedDB } from "./db";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function getAdminClient() {
  if (!supabaseUrl || !supabaseServiceKey) return null;
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function getAnonClient() {
  return createClient(supabaseUrl, supabaseAnonKey, {
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

// Check if auth_uid column exists by attempting a query
let _hasAuthUid: boolean | null = null;
async function hasAuthUidColumn(): Promise<boolean> {
  if (_hasAuthUid !== null) return _hasAuthUid;
  const admin = getAdminClient();
  if (!admin) return false;
  const { error } = await admin
    .from("users")
    .select("auth_uid")
    .limit(1);
  _hasAuthUid = !error;
  return _hasAuthUid;
}

// Verify token — supports both Supabase JWT and legacy custom JWT
export async function verifyToken(token: string): Promise<JWTPayload | null> {
  const admin = getAdminClient();
  if (!admin) return null;

  // Try Supabase Auth first
  const { data, error } = await admin.auth.getUser(token);
  if (!error && data.user) {
    const authUid = data.user.id;

    // Try auth_uid lookup first
    if (await hasAuthUidColumn()) {
      const { data: profile } = await admin
        .from("users")
        .select("id, email, name, role, company_id")
        .eq("auth_uid", authUid)
        .single();

      if (profile) {
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
    }

    // Fallback: look up by email (for users created before auth_uid migration)
    const { data: profileByEmail } = await admin
      .from("users")
      .select("id, email, name, role, company_id")
      .eq("email", data.user.email!)
      .single();

    if (profileByEmail) {
      const { data: company } = await admin
        .from("companies")
        .select("name, rfc")
        .eq("id", profileByEmail.company_id)
        .single();

      return {
        sub: String(profileByEmail.id),
        email: profileByEmail.email,
        name: profileByEmail.name,
        role: profileByEmail.role,
        company_id: String(profileByEmail.company_id),
        company_name: company?.name || "",
        company_rfc: company?.rfc || "",
      };
    }
  }

  return null;
}

export interface StoredUser {
  id: number;
  email: string;
  name: string;
  role: string;
  company_id: number;
  company_name: string;
  company_rfc: string;
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
    throw new Error(
      "Base de datos no configurada. Configura Supabase primero."
    );
  }

  // Check if user already exists
  const { data: existingUser } = await admin
    .from("users")
    .select("id")
    .eq("email", normalizedEmail)
    .single();
  if (existingUser) {
    throw new Error("El correo ya está registrado");
  }

  // 1. Create auth user via Supabase Auth
  const { data: authData, error: authError } =
    await admin.auth.admin.createUser({
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
    if (companyError)
      throw new Error(`Error al crear empresa: ${companyError.message}`);
    const companyId = companies?.[0]?.id;
    if (!companyId) throw new Error("Error al crear empresa");

    // 3. Create user profile
    const userRecord: Record<string, unknown> = {
      email: normalizedEmail,
      password_hash: "SUPABASE_AUTH",
      name,
      role: "admin",
      company_id: companyId,
    };

    // Add auth_uid if the column exists
    if (await hasAuthUidColumn()) {
      userRecord.auth_uid = authUid;
    }

    const { data: users, error: userError } = await insert("users", userRecord);
    if (userError)
      throw new Error(`Error al crear usuario: ${userError.message}`);
    if (!users?.[0]) throw new Error("Error al crear usuario");

    // 4. Seed demo data (only for demo accounts, not real registrations)
    if (normalizedEmail.endsWith("@payana.demo")) {
      await seedDB(companyId);
    }

    // 5. Sign in to get session token
    const { data: signInData, error: signInError } =
      await getAnonClient().auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

    if (signInError || !signInData.session) {
      throw new Error(
        "Cuenta creada pero error al iniciar sesión. Intenta iniciar sesión manualmente."
      );
    }

    return {
      id: users[0].id,
      email: normalizedEmail,
      name,
      role: "admin",
      company_id: companyId,
      company_name: companyName,
      company_rfc: rfc,
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
  const admin = getAdminClient();
  if (!admin) throw new Error("Error de configuración del servidor");

  // Try Supabase Auth sign-in first
  const { data: signInData, error: signInError } =
    await getAnonClient().auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

  if (!signInError && signInData.session) {
    // Supabase Auth login succeeded — find user profile
    const authUid = signInData.user.id;

    let profile: Record<string, unknown> | null = null;

    // Try auth_uid first
    if (await hasAuthUidColumn()) {
      const { data } = await admin
        .from("users")
        .select("id, email, name, role, company_id")
        .eq("auth_uid", authUid)
        .single();
      profile = data;
    }

    // Fallback to email
    if (!profile) {
      const { data } = await admin
        .from("users")
        .select("id, email, name, role, company_id")
        .eq("email", normalizedEmail)
        .single();
      profile = data;
    }

    if (!profile) {
      throw new Error(
        "Usuario no encontrado en el sistema. Contacta al administrador."
      );
    }

    const { data: company } = await admin
      .from("companies")
      .select("name, rfc")
      .eq("id", profile.company_id)
      .single();

    return {
      id: profile.id as number,
      email: profile.email as string,
      name: profile.name as string,
      role: profile.role as string,
      company_id: profile.company_id as number,
      company_name: (company?.name as string) || "",
      company_rfc: (company?.rfc as string) || "",
      access_token: signInData.session.access_token,
    };
  }

  // Supabase Auth failed — try legacy plaintext password (for pre-migration users)
  const { data: legacyUser } = await admin
    .from("users")
    .select("id, email, password_hash, name, role, company_id")
    .eq("email", normalizedEmail)
    .single();

  if (
    !legacyUser ||
    legacyUser.password_hash === "SUPABASE_AUTH" ||
    legacyUser.password_hash !== password
  ) {
    throw new Error("Credenciales inválidas");
  }

  // Legacy user found — migrate to Supabase Auth
  const { data: newAuth, error: createError } =
    await admin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: { name: legacyUser.name },
    });

  if (createError) {
    throw new Error("Credenciales inválidas");
  }

  // Update user record with auth_uid and clear plaintext password
  if (await hasAuthUidColumn()) {
    await admin
      .from("users")
      .update({
        auth_uid: newAuth.user.id,
        password_hash: "SUPABASE_AUTH",
      })
      .eq("id", legacyUser.id);
  } else {
    await admin
      .from("users")
      .update({ password_hash: "SUPABASE_AUTH" })
      .eq("id", legacyUser.id);
  }

  // Sign in with new auth credentials
  const { data: newSession, error: newSignInError } =
    await getAnonClient().auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

  if (newSignInError || !newSession.session) {
    throw new Error("Error al migrar cuenta. Intenta de nuevo.");
  }

  const { data: company } = await admin
    .from("companies")
    .select("name, rfc")
    .eq("id", legacyUser.company_id)
    .single();

  return {
    id: legacyUser.id,
    email: legacyUser.email,
    name: legacyUser.name,
    role: legacyUser.role,
    company_id: legacyUser.company_id,
    company_name: company?.name || "",
    company_rfc: company?.rfc || "",
    access_token: newSession.session.access_token,
  };
}
