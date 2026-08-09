import { useEffect } from "react";
import SideNav from "./SideNav";
import BottomNav from "@/components/BottomNav";
import "../theme.css";

/**
 * AppShell — V2 responsive layout wrapper
 *
 * ≥ 1024px (lg):  Fixed left sidebar (240px) + scrollable main content area
 * <  1024px:      Full-width content + existing BottomNav (mobile-first preserved)
 *
 * Usage:
 *   <AppShell>
 *     <YourPageContent />
 *   </AppShell>
 */

interface AppShellProps {
  children: React.ReactNode;
  /** Optional extra padding-bottom on mobile (default 80px to clear BottomNav) */
  mobilePb?: number;
}

export default function AppShell({ children, mobilePb = 80 }: AppShellProps) {
  // Add the .v2 class to body so theme.css tokens cascade down
  useEffect(() => {
    document.body.classList.add("v2");
    return () => document.body.classList.remove("v2");
  }, []);

  return (
    <>
      {/* ── Desktop: sidebar + main ─────────────────────────── */}
      <div
        className="hidden lg:flex"
        style={{ minHeight: "100vh", background: "hsl(210 20% 98%)" }}
      >
        <SideNav />

        {/* Main content area — offset by sidebar width */}
        <main
          style={{
            marginLeft: "var(--v2-sidebar-w, 240px)",
            flex: 1,
            minWidth: 0,
            overflowX: "hidden",
            background: "hsl(210 14% 96%)" /* subtle off-white page bg */,
          }}
        >
          {children}
        </main>
      </div>

      {/* ── Mobile: full-width content + BottomNav ─────────── */}
      <div
        className="lg:hidden"
        style={{
          minHeight: "100vh",
          background: "#fff",
          paddingBottom: mobilePb,
        }}
      >
        {children}
        <BottomNav />
      </div>
    </>
  );
}
