import { describe, it, expect, vi } from "vitest";
import { maskConfig, resolveConfig } from "./auth-helpers";

// Mock the supabase admin module since it's not needed for these tests
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: vi.fn(),
}));

describe("maskConfig", () => {
  it("masks sensitive fields", () => {
    const config = {
      url: "https://odoo.test.com",
      database: "mydb",
      user: "admin",
      password: "secret123",
    };
    const result = maskConfig(config);
    expect(result).not.toBeNull();
    expect(result!.url).toBe("https://odoo.test.com");
    expect(result!.database).toBe("mydb");
    expect(result!.user).toBe("admin");
    expect(result!.password).toBe("••••••••");
  });

  it("masks secretKey and webhookSecret", () => {
    const config = {
      publicKey: "pk_live_123",
      secretKey: "sk_live_secret",
      webhookSecret: "whsec_abc",
    };
    const result = maskConfig(config);
    expect(result!.publicKey).toBe("pk_live_123");
    expect(result!.secretKey).toBe("••••••••");
    expect(result!.webhookSecret).toBe("••••••••");
  });

  it("masks keyPassword and smtpPassword", () => {
    const config = {
      keyPassword: "myKeyPass",
      smtpPassword: "smtpSecret",
      smtpHost: "smtp.gmail.com",
    };
    const result = maskConfig(config);
    expect(result!.keyPassword).toBe("••••••••");
    expect(result!.smtpPassword).toBe("••••••••");
    expect(result!.smtpHost).toBe("smtp.gmail.com");
  });

  it("returns null for null input", () => {
    expect(maskConfig(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(maskConfig(undefined)).toBeNull();
  });

  it("does not mask empty sensitive values", () => {
    const config = { password: "", secretKey: "" };
    const result = maskConfig(config);
    // Empty strings are falsy, so they won't be masked
    expect(result!.password).toBe("");
    expect(result!.secretKey).toBe("");
  });
});

describe("resolveConfig", () => {
  it("returns frontend config when no saved config", () => {
    const frontend = { url: "https://new.com", password: "new_pass" };
    const result = resolveConfig(frontend, undefined);
    expect(result).toEqual(frontend);
  });

  it("returns saved config when no frontend config", () => {
    const saved = { url: "https://saved.com", password: "saved_pass" };
    const result = resolveConfig(undefined, saved);
    expect(result).toEqual(saved);
  });

  it("resolves masked passwords from saved config", () => {
    const frontend = { url: "https://new.com", password: "••••••••" };
    const saved = { url: "https://old.com", password: "actual_password" };
    const result = resolveConfig(frontend, saved);
    expect(result.url).toBe("https://new.com");
    expect(result.password).toBe("actual_password");
  });

  it("resolves bullet mask (••••••••) from saved config", () => {
    const frontend = { secretKey: "••••••••" };
    const saved = { secretKey: "sk_live_real_key" };
    const result = resolveConfig(frontend, saved);
    expect(result.secretKey).toBe("sk_live_real_key");
  });

  it("uses new value when not masked", () => {
    const frontend = { password: "new_password" };
    const saved = { password: "old_password" };
    const result = resolveConfig(frontend, saved);
    expect(result.password).toBe("new_password");
  });

  it("handles empty saved config", () => {
    const frontend = { url: "https://new.com", password: "pass" };
    const result = resolveConfig(frontend, {} as Record<string, string>);
    expect(result).toEqual(frontend);
  });

  it("resolves mask to empty when saved has no value", () => {
    const frontend = { password: "••••••••" };
    const saved = {} as Record<string, string>;
    const result = resolveConfig(frontend, saved);
    expect(result.password).toBe("");
  });
});
