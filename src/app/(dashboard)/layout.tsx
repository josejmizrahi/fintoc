"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore, useSidebarStore } from "@/lib/store";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { cn } from "@/lib/utils";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const collapsed = useSidebarStore((s) => s.collapsed);

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthenticated, router]);

  // Show nothing while redirecting unauthenticated users
  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar - hidden on mobile, shown on md+ */}
      <div className="hidden md:block">
        <Sidebar />
      </div>

      {/* Main content area - offset by sidebar width */}
      <div
        className={cn(
          "flex min-h-screen flex-col transition-all duration-300",
          collapsed ? "md:ml-16" : "md:ml-64"
        )}
      >
        <Header />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
