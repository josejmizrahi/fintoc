import { SignJWT, jwtVerify } from "jose";

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

// Simple in-memory user store (resets on cold start — fine for demo)
interface StoredUser {
  id: number;
  email: string;
  name: string;
  role: string;
  password: string;
  company_id: number;
  company_name: string;
  company_rfc: string;
}

const users: StoredUser[] = [];
let nextUserId = 1;
let nextCompanyId = 1;

export function findUserByEmail(email: string): StoredUser | undefined {
  return users.find((u) => u.email === email);
}

export function registerUser(
  email: string,
  password: string,
  name: string,
  companyName: string,
  rfc: string
): StoredUser {
  if (findUserByEmail(email)) {
    throw new Error("El correo ya está registrado");
  }
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
  users.push(user);
  return user;
}
