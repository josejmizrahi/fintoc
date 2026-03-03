import { create } from "zustand";

interface UserData {
  id: number;
  email: string;
  name: string;
  role: string;
}

interface TenantData {
  id: string;
  name: string;
  rfc: string;
}

interface AuthState {
  isAuthenticated: boolean;
  token: string;
  user: UserData | null;
  tenantId: string;
  tenantName: string;
  loginWithToken: (token: string, user: UserData, tenant: TenantData) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated:
    typeof window !== "undefined" ? !!localStorage.getItem("token") : false,
  token:
    typeof window !== "undefined"
      ? localStorage.getItem("token") || ""
      : "",
  user:
    typeof window !== "undefined"
      ? JSON.parse(localStorage.getItem("user") || "null")
      : null,
  tenantId:
    typeof window !== "undefined"
      ? localStorage.getItem("tenantId") || ""
      : "",
  tenantName:
    typeof window !== "undefined"
      ? localStorage.getItem("tenantName") || ""
      : "",
  loginWithToken: (token, user, tenant) => {
    localStorage.setItem("token", token);
    localStorage.setItem("tenantId", tenant.id);
    localStorage.setItem("tenantName", tenant.name);
    localStorage.setItem("user", JSON.stringify(user));
    set({
      isAuthenticated: true,
      token,
      user,
      tenantId: tenant.id,
      tenantName: tenant.name,
    });
  },
  logout: () => {
    localStorage.removeItem("token");
    localStorage.removeItem("tenantId");
    localStorage.removeItem("tenantName");
    localStorage.removeItem("user");
    set({
      isAuthenticated: false,
      token: "",
      user: null,
      tenantId: "",
      tenantName: "",
    });
  },
}));

interface SidebarState {
  collapsed: boolean;
  toggle: () => void;
}

export const useSidebarStore = create<SidebarState>((set) => ({
  collapsed: false,
  toggle: () => set((s) => ({ collapsed: !s.collapsed })),
}));
