import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import teckstartLogo from "@/assets/teckstart-logo.png";
import {
  Camera, FileText, LayoutDashboard, Settings,
  Layers, TrendingUp, Zap, Receipt, DollarSign,
  ShoppingCart, Users, ChevronDown, ChevronRight,
  LogOut, Crown,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

interface NavItem {
  path: string;
  icon: React.ElementType;
  label: string;
  v2path?: string; // if set, navigate to v2 route instead
}

interface NavSection {
  key: string;
  label: string;
  items: NavItem[];
}

// ── Nav structure ──────────────────────────────────────────────────────────

function useNavSections(isOwner: boolean): NavSection[] {
  return [
    {
      key: "main",
      label: "Main",
      items: [
        { path: "/home",      v2path: "/home2",      icon: Camera,         label: "Capture" },
        { path: "/drafts",    v2path: "/drafts2",    icon: FileText,       label: "Drafts" },
        { path: "/dashboard", v2path: "/dashboard2", icon: LayoutDashboard, label: "Dashboard" },
      ],
    },
    {
      key: "manage",
      label: "Manage",
      items: [
        { path: "/bulk",   v2path: "/bulk2",   icon: Layers,    label: "Bulk List" },
        { path: "/market", v2path: "/market2", icon: TrendingUp, label: "Market Research" },
        ...(isOwner ? [{ path: "/reprice-rules", v2path: "/reprice-rules2", icon: Zap, label: "Optimize" }] : []),
      ],
    },
    ...(isOwner ? [{
      key: "money",
      label: "Money",
      items: [
        { path: "/profit-report",   v2path: "/profit-report2",   icon: Receipt,      label: "P&L Report" },
        { path: "/cogs-editor",     v2path: "/cogs-editor2",     icon: DollarSign,   label: "COGS Editor" },
        { path: "/historical-cogs", v2path: "/historical-cogs2", icon: ShoppingCart, label: "Backfill COGS" },
      ],
    }] : []),
    {
      key: "account",
      label: "Account",
      items: [
        { path: "/team",     v2path: "/team2",     icon: Users,    label: "Team" },
        { path: "/settings", v2path: "/settings2", icon: Settings, label: "Settings" },
      ],
    },
  ];
}

// ── Component ──────────────────────────────────────────────────────────────

export default function SideNav() {
  const location  = useLocation();
  const navigate  = useNavigate();
  const { isOwner, signOut, user, currentPlan } = useAuth();
  const sections  = useNavSections(isOwner);

  // All sections start expanded (per spec)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const isActive = (item: NavItem) => {
    const p = location.pathname;
    // Match both v1 and v2 paths so the sidebar highlights correctly on either version
    return p === item.path || (item.v2path ? p === item.v2path : false);
  };

  const handleNav = (item: NavItem) => {
    // Navigate to v2 path if available, else v1
    navigate(item.v2path ?? item.path);
  };

  const toggleSection = (key: string) => {
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <aside
      className="v2-sidenav"
      style={{
        width: "var(--v2-sidebar-w, 240px)",
        minHeight: "100vh",
        background: "hsl(201 100% 36%)",  /* Honolulu Blue */
        display: "flex",
        flexDirection: "column",
        position: "fixed",
        top: 0,
        left: 0,
        bottom: 0,
        zIndex: 40,
        overflowY: "auto",
        overflowX: "hidden",
      }}
    >
      {/* ── Logo ──────────────────────────────────────────────── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        padding: "1.25rem 1.25rem 1rem",
        borderBottom: "1px solid rgba(255,255,255,0.12)",
      }}>
        <img
          src={teckstartLogo}
          alt="Teckstart"
          style={{ height: 32, width: "auto", maxWidth: 120, flexShrink: 0, objectFit: "contain" }}
        />
        <div>
          <div style={{ color: "#fff", fontWeight: 700, fontSize: "0.9375rem", lineHeight: 1.2 }}>
            Teckstart
          </div>
          <div style={{ color: "rgba(255,255,255,0.65)", fontSize: "0.75rem", fontWeight: 500 }}>
            Lister
          </div>
        </div>
      </div>

      {/* ── Nav sections ──────────────────────────────────────── */}
      <nav style={{ flex: 1, padding: "0.75rem 0.625rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        {sections.map((section) => {
          const isCollapsed = !!collapsed[section.key];
          return (
            <div key={section.key} style={{ marginBottom: "0.25rem" }}>
              {/* Section header */}
              <button
                onClick={() => toggleSection(section.key)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0.375rem 0.625rem",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "rgba(255,255,255,0.55)",
                  fontSize: "0.6875rem",
                  fontWeight: 700,
                  letterSpacing: "0.07em",
                  textTransform: "uppercase",
                  borderRadius: 6,
                  transition: "color 0.15s",
                }}
                onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,255,255,0.85)")}
                onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.55)")}
              >
                <span>{section.label}</span>
                {isCollapsed
                  ? <ChevronRight style={{ width: 12, height: 12 }} />
                  : <ChevronDown  style={{ width: 12, height: 12 }} />
                }
              </button>

              {/* Section items */}
              {!isCollapsed && (
                <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 2 }}>
                  {section.items.map((item) => {
                    const active = isActive(item);
                    return (
                      <button
                        key={item.path}
                        onClick={() => handleNav(item)}
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          gap: "0.625rem",
                          padding: "0.5rem 0.75rem",
                          background: active ? "rgba(255,255,255,0.18)" : "transparent",
                          border: "none",
                          borderRadius: 8,
                          cursor: "pointer",
                          color: active ? "#fff" : "rgba(255,255,255,0.78)",
                          fontSize: "0.9375rem",
                          fontWeight: active ? 600 : 500,
                          textAlign: "left",
                          transition: "background 0.15s, color 0.15s",
                        }}
                        onMouseEnter={e => {
                          if (!active) {
                            e.currentTarget.style.background = "rgba(255,255,255,0.1)";
                            e.currentTarget.style.color = "#fff";
                          }
                        }}
                        onMouseLeave={e => {
                          if (!active) {
                            e.currentTarget.style.background = "transparent";
                            e.currentTarget.style.color = "rgba(255,255,255,0.78)";
                          }
                        }}
                      >
                        {/* Active indicator bar */}
                        <span style={{
                          width: 3,
                          height: 18,
                          borderRadius: 2,
                          background: active ? "#fff" : "transparent",
                          flexShrink: 0,
                          marginLeft: -4,
                        }} />
                        <item.icon style={{ width: 18, height: 18, flexShrink: 0 }} />
                        <span style={{ flex: 1 }}>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* ── User footer ───────────────────────────────────────── */}
      <div style={{
        borderTop: "1px solid rgba(255,255,255,0.12)",
        padding: "0.875rem 1rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
      }}>
        {/* Plan badge */}
        {currentPlan && (
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "0.375rem",
            padding: "0.25rem 0.625rem",
            background: "rgba(255,255,255,0.12)",
            borderRadius: 20,
            width: "fit-content",
          }}>
            <Crown style={{ width: 12, height: 12, color: "#FFD700" }} />
            <span style={{ color: "rgba(255,255,255,0.85)", fontSize: "0.75rem", fontWeight: 600, textTransform: "capitalize" }}>
              {currentPlan}
            </span>
          </div>
        )}

        {/* User email */}
        {user?.email && (
          <div style={{
            color: "rgba(255,255,255,0.6)",
            fontSize: "0.75rem",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {user.email}
          </div>
        )}

        {/* Sign out */}
        <button
          onClick={() => signOut()}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "rgba(255,255,255,0.65)",
            fontSize: "0.8125rem",
            fontWeight: 500,
            padding: "0.25rem 0",
            transition: "color 0.15s",
          }}
          onMouseEnter={e => (e.currentTarget.style.color = "#fff")}
          onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.65)")}
        >
          <LogOut style={{ width: 15, height: 15 }} />
          Sign out
        </button>
      </div>
    </aside>
  );
}