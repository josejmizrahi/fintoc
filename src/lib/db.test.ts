import { describe, it, expect, vi, beforeEach } from "vitest";

describe("hasDB", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns true when env vars are set", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
    const { hasDB } = await import("./db");
    expect(hasDB()).toBe(true);
  });

  it("returns false when SUPABASE_URL is empty", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
    const { hasDB } = await import("./db");
    expect(hasDB()).toBe(false);
  });

  it("returns false when SERVICE_ROLE_KEY is empty", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const { hasDB } = await import("./db");
    expect(hasDB()).toBe(false);
  });

  it("returns false when both env vars are missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const { hasDB } = await import("./db");
    expect(hasDB()).toBe(false);
  });
});

describe("query/insert/update with no DB", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  });

  it("query returns error when no DB", async () => {
    const { query } = await import("./db");
    const result = await query("customers");
    expect(result.data).toBeNull();
    expect(result.error).toBeDefined();
    expect(result.error.message).toContain("No Supabase");
  });

  it("insert returns error when no DB", async () => {
    const { insert } = await import("./db");
    const result = await insert("customers", { name: "Test" });
    expect(result.data).toBeNull();
    expect(result.error).toBeDefined();
  });

  it("update returns error when no DB", async () => {
    const { update } = await import("./db");
    const result = await update("customers", { name: "New" }, { id: 1 });
    expect(result.data).toBeNull();
    expect(result.error).toBeDefined();
  });
});
