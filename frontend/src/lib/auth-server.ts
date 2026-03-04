import { SignJWT, jwtVerify } from "jose";
import { hasDB, query, insert, seedDB } from "./db";

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "payana-demo-secret-change-in-production"
);

export interface JWTPayload {
  sub: string;
  email: string;
  name: string;
  role: string;
  company_id: string;
  company_name: string;
  company_rfc: string;
}

export async function createToken(payload: JWTPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(SECRET);
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

export interface StoredUser {
  id: number;
  email: string;
  name: string;
  role: string;
  password: string;
  company_id: number;
  company_name: string;
  company_rfc: string;
}

// ── In-memory fallback (when no DB configured) ──
const memUsers: StoredUser[] = [];
let nextUserId = 1;
let nextCompanyId = 1;

// ── DB-backed functions ──

export async function findUserByEmail(email: string): Promise<StoredUser | undefined> {
  const normalizedEmail = email.toLowerCase().trim();

  if (hasDB()) {
    // Get user
    const { data: user, error: userError } = await query("users", {
      select: "id, email, password_hash, name, role, company_id",
      match: { email: normalizedEmail },
      single: true,
    });

    if (userError && !userError.message?.includes("rows returned")) {
      console.error("DB findUserByEmail error:", userError.message);
    }

    if (!user) return undefined;

    // Get company
    const { data: company } = await query("companies", {
      select: "name, rfc",
      match: { id: user.company_id },
      single: true,
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      password: user.password_hash,
      company_id: user.company_id,
      company_name: company?.name || "",
      company_rfc: company?.rfc || "",
    };
  }

  return memUsers.find((u) => u.email === normalizedEmail);
}

export async function registerUser(
  email: string,
  password: string,
  name: string,
  companyName: string,
  rfc: string
): Promise<StoredUser> {
  const normalizedEmail = email.toLowerCase().trim();

  const existing = await findUserByEmail(normalizedEmail);
  if (existing) {
    throw new Error("El correo ya está registrado");
  }

  if (hasDB()) {
    // Create or get company
    const { data: companies, error: companyError } = await insert("companies", { name: companyName, rfc });
    if (companyError) {
      console.error("DB company insert error:", companyError.message);
      throw new Error(`Error al crear empresa: ${companyError.message}`);
    }
    const companyId = companies?.[0]?.id;
    if (!companyId) throw new Error("Error al crear empresa");

    // Create user
    const { data: users, error: userError } = await insert("users", {
      email: normalizedEmail,
      password_hash: password,
      name,
      role: "admin",
      company_id: companyId,
    });
    if (userError) {
      console.error("DB user insert error:", userError.message);
      throw new Error(`Error al crear usuario: ${userError.message}`);
    }
    if (!users?.[0]) throw new Error("Error al crear usuario");

    // Seed demo data for this company
    await seedDB(companyId);

    return {
      id: users[0].id,
      email: normalizedEmail,
      name,
      role: "admin",
      password,
      company_id: companyId,
      company_name: companyName,
      company_rfc: rfc,
    };
  }

  // In-memory fallback (only when no DB configured)
  const companyId = nextCompanyId++;
  const user: StoredUser = {
    id: nextUserId++,
    email: normalizedEmail,
    name,
    role: "admin",
    password,
    company_id: companyId,
    company_name: companyName,
    company_rfc: rfc,
  };
  memUsers.push(user);
  return user;
}
