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
  if (hasDB()) {
    try {
      // Get user
      const { data: user } = await query("users", {
        select: "id, email, password_hash, name, role, company_id",
        match: { email },
        single: true,
      });
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
    } catch {
      // DB error — fall through to in-memory
    }
  }
  return memUsers.find((u) => u.email === email);
}

export async function registerUser(
  email: string,
  password: string,
  name: string,
  companyName: string,
  rfc: string
): Promise<StoredUser> {
  const existing = await findUserByEmail(email);
  if (existing) {
    throw new Error("El correo ya está registrado");
  }

  if (hasDB()) {
    try {
      // Create or get company
      const { data: companies } = await insert("companies", { name: companyName, rfc });
      const companyId = companies?.[0]?.id;
      if (!companyId) throw new Error("Error creating company");

      // Create user
      const { data: users } = await insert("users", {
        email,
        password_hash: password,
        name,
        role: "admin",
        company_id: companyId,
      });
      if (!users?.[0]) throw new Error("Error creating user");

      // Seed demo data for this company
      await seedDB(companyId);

      return {
        id: users[0].id,
        email,
        name,
        role: "admin",
        password,
        company_id: companyId,
        company_name: companyName,
        company_rfc: rfc,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "DB error";
      if (msg.includes("ya está registrado")) throw e;
      console.error("DB register error, falling back to memory:", msg);
    }
  }

  // In-memory fallback
  const companyId = nextCompanyId++;
  const user: StoredUser = {
    id: nextUserId++,
    email,
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
