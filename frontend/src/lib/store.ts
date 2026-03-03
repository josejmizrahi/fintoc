import { create } from "zustand";

interface AuthState {
  isAuthenticated: boolean;
  user: { email: string; name: string; role: string } | null;
  tenantId: string;
  tenantName: string;
  login: (email: string, tenantId: string, tenantName: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: typeof window !== "undefined" ? !!localStorage.getItem("tenantId") : false,
  user: typeof window !== "undefined" ? JSON.parse(localStorage.getItem("user") || "null") : null,
  tenantId: typeof window !== "undefined" ? localStorage.getItem("tenantId") || "" : "",
  tenantName: typeof window !== "undefined" ? localStorage.getItem("tenantName") || "" : "",
  login: (email, tenantId, tenantName) => {
    const user = { email, name: email.split("@")[0], role: "admin" };
    localStorage.setItem("tenantId", tenantId);
    localStorage.setItem("tenantName", tenantName);
    localStorage.setItem("user", JSON.stringify(user));
    set({ isAuthenticated: true, user, tenantId, tenantName });
  },
  logout: () => {
    localStorage.removeItem("tenantId");
    localStorage.removeItem("tenantName");
    localStorage.removeItem("user");
    set({ isAuthenticated: false, user: null, tenantId: "", tenantName: "" });
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
