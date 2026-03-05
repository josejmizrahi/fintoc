import { describe, it, expect } from "vitest";
import { checkPermission, checkRouteAccess, getActionAndResource } from "./rbac";

describe("checkPermission", () => {
  it("admin has full access to everything", () => {
    expect(checkPermission("admin", "read", "payments")).toBe(true);
    expect(checkPermission("admin", "execute", "payments")).toBe(true);
    expect(checkPermission("admin", "configure", "integrations")).toBe(true);
    expect(checkPermission("admin", "delete", "vendors")).toBe(true);
  });

  it("manager can CRUD but not configure", () => {
    expect(checkPermission("manager", "read", "payments")).toBe(true);
    expect(checkPermission("manager", "create", "payments")).toBe(true);
    expect(checkPermission("manager", "execute", "payments")).toBe(true);
    expect(checkPermission("manager", "approve", "payments")).toBe(true);
    expect(checkPermission("manager", "configure", "integrations")).toBe(false);
  });

  it("accountant can read all but cannot execute or approve", () => {
    expect(checkPermission("accountant", "read", "payments")).toBe(true);
    expect(checkPermission("accountant", "read", "invoices")).toBe(true);
    expect(checkPermission("accountant", "create", "payments")).toBe(true);
    expect(checkPermission("accountant", "create", "invoices")).toBe(true);
    expect(checkPermission("accountant", "execute", "payments")).toBe(false);
    expect(checkPermission("accountant", "approve", "payments")).toBe(false);
    expect(checkPermission("accountant", "delete", "payments")).toBe(false);
  });

  it("viewer can only read", () => {
    expect(checkPermission("viewer", "read", "payments")).toBe(true);
    expect(checkPermission("viewer", "read", "invoices")).toBe(true);
    expect(checkPermission("viewer", "create", "payments")).toBe(false);
    expect(checkPermission("viewer", "execute", "payments")).toBe(false);
    expect(checkPermission("viewer", "approve", "expenses")).toBe(false);
    expect(checkPermission("viewer", "configure", "integrations")).toBe(false);
    expect(checkPermission("viewer", "delete", "vendors")).toBe(false);
  });

  it("unknown role has no access", () => {
    expect(checkPermission("unknown", "read", "payments")).toBe(false);
    expect(checkPermission("", "read", "payments")).toBe(false);
  });
});

describe("getActionAndResource", () => {
  it("maps GET to read action", () => {
    expect(getActionAndResource("GET", "payments")).toEqual({ action: "read", resource: "payments" });
  });

  it("maps POST to create action", () => {
    expect(getActionAndResource("POST", "invoices")).toEqual({ action: "create", resource: "invoices" });
  });

  it("maps PUT to update action", () => {
    expect(getActionAndResource("PUT", "vendors/123")).toEqual({ action: "update", resource: "vendors" });
  });

  it("maps DELETE to delete action", () => {
    expect(getActionAndResource("DELETE", "customers/5")).toEqual({ action: "delete", resource: "customers" });
  });

  it("detects execute action from path", () => {
    expect(getActionAndResource("POST", "payments/123/execute")).toEqual({ action: "execute", resource: "payments" });
  });

  it("detects approve action from path", () => {
    expect(getActionAndResource("POST", "approvals/1/approve")).toEqual({ action: "approve", resource: "approvals" });
  });

  it("detects configure action for integrations", () => {
    expect(getActionAndResource("POST", "integrations")).toEqual({ action: "configure", resource: "integrations" });
    expect(getActionAndResource("GET", "integrations")).toEqual({ action: "read", resource: "integrations" });
  });

  it("returns null for unknown resource", () => {
    expect(getActionAndResource("GET", "unknown-resource")).toBeNull();
  });
});

describe("checkRouteAccess", () => {
  it("allows admin to access everything", () => {
    expect(checkRouteAccess("admin", "POST", "payments/123/execute")).toBeNull();
    expect(checkRouteAccess("admin", "POST", "integrations")).toBeNull();
  });

  it("denies viewer from creating payments", () => {
    const result = checkRouteAccess("viewer", "POST", "payments/vendor");
    expect(result).toContain("Acceso denegado");
    expect(result).toContain("viewer");
  });

  it("denies accountant from executing payments", () => {
    const result = checkRouteAccess("accountant", "POST", "payments/123/execute");
    expect(result).toContain("Acceso denegado");
  });

  it("denies viewer from deleting resources", () => {
    const result = checkRouteAccess("viewer", "DELETE", "vendors/5");
    expect(result).toContain("Acceso denegado");
  });

  it("allows manager to execute payments", () => {
    expect(checkRouteAccess("manager", "POST", "payments/123/execute")).toBeNull();
  });

  it("passes through unknown routes", () => {
    expect(checkRouteAccess("viewer", "GET", "unknown-path")).toBeNull();
  });
});
