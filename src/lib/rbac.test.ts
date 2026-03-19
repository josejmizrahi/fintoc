import { describe, it, expect } from "vitest";
import { hasPermission } from "./rbac";

describe("hasPermission", () => {
  it("admin has full access to everything", () => {
    expect(hasPermission("admin", "payments.read")).toBe(true);
    expect(hasPermission("admin", "payments.execute")).toBe(true);
    expect(hasPermission("admin", "config.write")).toBe(true);
    expect(hasPermission("admin", "users.manage")).toBe(true);
  });

  it("accountant can read, create, execute payments but not cancel", () => {
    expect(hasPermission("accountant", "payments.read")).toBe(true);
    expect(hasPermission("accountant", "payments.create")).toBe(true);
    expect(hasPermission("accountant", "payments.execute")).toBe(true);
    expect(hasPermission("accountant", "invoices.read")).toBe(true);
    expect(hasPermission("accountant", "invoices.create")).toBe(true);
    expect(hasPermission("accountant", "invoices.validate")).toBe(true);
    expect(hasPermission("accountant", "expenses.approve")).toBe(true);
    expect(hasPermission("accountant", "sat.validate")).toBe(true);
    expect(hasPermission("accountant", "sync.execute")).toBe(true);
    // accountant cannot manage config or users
    expect(hasPermission("accountant", "config.write")).toBe(false);
    expect(hasPermission("accountant", "users.manage")).toBe(false);
  });

  it("viewer has read-only access to most resources", () => {
    expect(hasPermission("viewer", "payments.read")).toBe(true);
    expect(hasPermission("viewer", "invoices.read")).toBe(true);
    expect(hasPermission("viewer", "vendors.read")).toBe(true);
    expect(hasPermission("viewer", "customers.read")).toBe(true);
    expect(hasPermission("viewer", "reports.read")).toBe(true);
    expect(hasPermission("viewer", "dashboard.read")).toBe(true);
    // viewer cannot write or execute
    expect(hasPermission("viewer", "payments.create")).toBe(false);
    expect(hasPermission("viewer", "payments.execute")).toBe(false);
    expect(hasPermission("viewer", "expenses.approve")).toBe(false);
    expect(hasPermission("viewer", "config.write")).toBe(false);
    expect(hasPermission("viewer", "users.manage")).toBe(false);
    expect(hasPermission("viewer", "vendors.write")).toBe(false);
  });

  it("unknown role has no access", () => {
    expect(hasPermission("unknown", "payments.read")).toBe(false);
    expect(hasPermission("", "payments.read")).toBe(false);
  });
});
