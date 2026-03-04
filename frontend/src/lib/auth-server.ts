import { SignJWT, jwtVerify } from "jose";
import { hasDB, query, initDB, seedDB } from "./db";

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
      const res = await query(
        `SELECT u.id, u.email, u.password_hash as password, u.name, u.role,
                u.company_id, c.name as company_name, c.rfc as company_rfc
         FROM users u JOIN companies c ON u.company_id = c.id
         WHERE u.email = $1`,
        [email]
      );
      return res.rows[0] || undefined;
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
      await initDB();
      // Create company
      const compRes = await query(
        "INSERT INTO companies (name, rfc) VALUES ($1, $2) ON CONFLICT (rfc) DO UPDATE SET name=$1 RETURNING id",
        [companyName, rfc]
      );
      const companyId = compRes.rows[0].id;

      // Create user
      const userRes = await query(
        "INSERT INTO users (email, password_hash, name, role, company_id) VALUES ($1, $2, $3, 'admin', $4) RETURNING id",
        [email, password, name, companyId]
      );

      // Seed demo data for this company
      await seedDB(companyId);

      return {
        id: userRes.rows[0].id,
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
      // If DB fails, fall through to in-memory
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
