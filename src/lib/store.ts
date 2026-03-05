import { create } from 'zustand';
import type { Role } from './rbac';

interface Company {
  id: string;
  name: string;
  rfc: string;
  onboarding_completed?: boolean;
}

interface UserData {
  id: string;
  email: string;
  name: string;
}

interface AuthState {
  isAuthenticated: boolean;
  token: string;
  user: UserData | null;
  companies: Company[];
  activeCompany: Company | null;
  role: Role;
  loginWithToken: (token: string, user: UserData, company: Company, role?: Role) => void;
  setCompanies: (companies: Company[]) => void;
  switchCompany: (company: Company, role?: Role) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated:
    typeof window !== 'undefined' ? !!localStorage.getItem('token') : false,
  token:
    typeof window !== 'undefined' ? localStorage.getItem('token') || '' : '',
  user:
    typeof window !== 'undefined'
      ? JSON.parse(localStorage.getItem('user') || 'null')
      : null,
  companies:
    typeof window !== 'undefined'
      ? JSON.parse(localStorage.getItem('companies') || '[]')
      : [],
  activeCompany:
    typeof window !== 'undefined'
      ? JSON.parse(localStorage.getItem('activeCompany') || 'null')
      : null,
  role:
    (typeof window !== 'undefined'
      ? (localStorage.getItem('role') as Role)
      : null) || 'viewer',
  loginWithToken: (token, user, company, role = 'admin') => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('activeCompany', JSON.stringify(company));
    localStorage.setItem('companies', JSON.stringify([company]));
    localStorage.setItem('role', role);
    set({
      isAuthenticated: true,
      token,
      user,
      activeCompany: company,
      companies: [company],
      role,
    });
  },
  setCompanies: (companies) => {
    localStorage.setItem('companies', JSON.stringify(companies));
    set({ companies });
  },
  switchCompany: (company, role = 'admin') => {
    localStorage.setItem('activeCompany', JSON.stringify(company));
    localStorage.setItem('role', role);
    set({ activeCompany: company, role });
  },
  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('activeCompany');
    localStorage.removeItem('companies');
    localStorage.removeItem('role');
    set({
      isAuthenticated: false,
      token: '',
      user: null,
      activeCompany: null,
      companies: [],
      role: 'viewer',
    });
  },
}));

interface SidebarState {
  collapsed: boolean;
  mobileOpen: boolean;
  toggle: () => void;
  setMobileOpen: (open: boolean) => void;
}

export const useSidebarStore = create<SidebarState>((set) => ({
  collapsed: false,
  mobileOpen: false,
  toggle: () => set((s) => ({ collapsed: !s.collapsed })),
  setMobileOpen: (open) => set({ mobileOpen: open }),
}));

interface SyncState {
  lastSync: string | null;
  isSyncing: boolean;
  syncProgress: number;
  syncErrors: string[];
  setSync: (data: Partial<SyncState>) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  lastSync: null,
  isSyncing: false,
  syncProgress: 0,
  syncErrors: [],
  setSync: (data) => set(data),
}));

interface UIState {
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
}));
