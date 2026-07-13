/**
 * SideNav — V2 Sidebar Navigation ("Ember Standard")
 *
 * Features:
 *   - Theme-aware sidebar driven by --v2-sidebar-* tokens (light + dark)
 *   - Amber active state with left accent bar
 *   - Section-based collapsible navigation
 *   - Owner-only sections (Money section)
 *   - Light/dark toggle
 */

import { useState } from "react";
import {
  Camera, FileText, LayoutDashboard, Layers,
  TrendingUp, Zap, Receipt, DollarSign,
  ShoppingCart, Users, Settings,
  ChevronDown, ChevronUp, LogOut, Heart, LayoutList,
  Sun, Moon,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import teckstartLogo from "@/assets/teckstart-logo.png";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/providers/useTheme";

interface NavItem {
  path: string;
  icon: React.ElementType;
  label: string;
}

interface NavSection {
  key: string;
  label: string;
  items: NavItem[];
}

function useNavSections(isOwner: boolean): NavSection[] {
  return [
    {
      key: "main",
      label: "Main",
      items: [
        { path: "/home",      icon: Camera,         label: "Capture" },
        { path: "/drafts",    icon: FileText,       label: "Drafts" },
        { path: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
      ],
    },
    {
      key: "manage",
      label: "Manage",
      items: [
        { path: "/listings", icon: LayoutList,  label: "Edit Listings" },
        { path: "/bulk",     icon: Layers,      label: "Bulk List" },
        { path: "/market",   icon: TrendingUp,  label: "Market Research" },
        ...(isOwner ? [{ path: "/reprice-rules", icon: Zap, label: "Optimize" }] : []),
      ],
    },
    ...(isOwner ? [{
      key: "money",
      label: "Money",
      items: [
        { path: "/profit-report",   icon: Receipt,      label: "P&L Report" },
        { path: "/cogs-editor",     icon: DollarSign,   label: "COGS Editor" },
        { path: "/historical-cogs", icon: ShoppingCart, label: "Backfill COGS" },
      ],
    }] : []),
    {
      key: "account",
      label: "Account",
      items: [
        { path: "/team",     icon: Users,    label: "Team" },
        { path: "/settings", icon: Settings, label: "Settings" },
        { path: "/billing",  icon: Heart,    label: "Billing" },
      ],
    },
  ];
}

// ─── Component ─────────────────────────────────────────────────────────

export default function SideNav() {
  const location  = useLocation();
  const navigate  = useNavigate();
  const { isOwner, signOut, user, currentPlan } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const sections  = useNavSections(isOwner);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const isActive = (item: NavItem) => location.pathname === item.path;
  const handleNav = (item: NavItem) => navigate(item.path);
  const toggleSection = (key: string) =>
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <aside
      className="v2-sidenav"
      style={{
        width: "var(--v2-sidebar-w, 240px)",
        minHeight: "100vh",
        background: "hsl(var(--v2-sidebar-bg))",
        borderRight: "1px solid hsl(var(--v2-border))",
        color: "hsl(var(--v2-sidebar-fg))",
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
      {/* ─── Logo ──────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        padding: "1.25rem 1.25rem 1rem",
        borderBottom: "1px solid hsl(var(--v2-border))",
      }}>
        <img
          src={teckstartLogo}
          alt="Listing Assistant Pro"
          style={{ height: 30, width: "auto", maxWidth: 130, flexShrink: 0, objectFit: "contain" }}
        />
      </div>

      {/* ─── Navigation Sections ─────────────────────────────────────────── */}
      <div style={{ flex: 1, padding: "0.75rem 0.5rem" }}>
        {sections.map(section => {
          const isCollapsed = collapsed[section.key];
          return (
            <div key={section.key} style={{ marginBottom: "0.5rem" }}>
              {/* Section header */}
              <button
                onClick={() => toggleSection(section.key)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0.5rem 0.75rem",
                  background: "transparent",
                  border: "none",
                  color: "hsl(var(--v2-fg-subtle))",
                  fontSize: "0.6875rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.09em",
                  cursor: "pointer",
                }}
              >
                {section.label}
                {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              </button>

              {/* Section items */}
              {!isCollapsed && (
                <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 2 }}>
                  {section.items.map(item => {
                    const active = isActive(item);
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.path}
                        onClick={() => handleNav(item)}
                        style={{
                          position: "relative",
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          gap: "0.75rem",
                          padding: "0.625rem 0.75rem",
                          background: active ? "hsl(var(--v2-sidebar-active-bg))" : "transparent",
                          border: "none",
                          color: active ? "hsl(var(--v2-primary))" : "hsl(var(--v2-fg-muted))",
                          fontSize: "0.875rem",
                          fontWeight: active ? 600 : 500,
                          cursor: "pointer",
                          transition: "background 0.15s, color 0.15s",
                          borderRadius: 10,
                        }}
                        onMouseEnter={e => {
                          if (!active) {
                            e.currentTarget.style.background = "hsl(var(--v2-sidebar-hover))";
                            e.currentTarget.style.color = "hsl(var(--v2-fg))";
                          }
                        }}
                        onMouseLeave={e => {
                          if (!active) {
                            e.currentTarget.style.background = "transparent";
                            e.currentTarget.style.color = "hsl(var(--v2-fg-muted))";
                          }
                        }}
                      >
                        {active && (
                          <span style={{
                            position: "absolute",
                            left: 0,
                            top: "50%",
                            transform: "translateY(-50%)",
                            width: 3,
                            height: 18,
                            borderRadius: 3,
                            background: "hsl(var(--v2-primary))",
                          }} />
                        )}
                        <Icon size={17} style={{ flexShrink: 0 }} />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ─── User & Sign Out ─────────────────────────────────────────────── */}
      <div style={{
        padding: "0.75rem 0.875rem 1.5rem",
        borderTop: "1px solid hsl(var(--v2-border))",
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "0.625rem",
          marginBottom: "0.75rem",
        }}>
          <div style={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            background: "hsl(var(--v2-primary))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "hsl(var(--v2-primary-fg))",
            fontSize: "0.8125rem",
            fontWeight: 700,
            flexShrink: 0,
          }}>
            {user?.email?.[0]?.toUpperCase() || "U"}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              color: "hsl(var(--v2-fg))",
              fontSize: "0.8125rem",
              fontWeight: 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}>
              {user?.email || "User"}
            </div>
            <div style={{
              color: "hsl(var(--v2-fg-subtle))",
              fontSize: "0.6875rem",
              marginTop: "0.125rem",
            }}>
              {currentPlan === "free" ? "Free Plan"
               : currentPlan === "starter" ? "Starter"
               : currentPlan === "pro" ? "Pro"
               : currentPlan === "shop" ? "Shop"
               : "Unlimited"}
            </div>
          </div>
        </div>

        {/* ─── Theme Toggle ───────────────────────────────────────────── */}
        <button
          onClick={toggleTheme}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0.4375rem 0.75rem",
            marginBottom: "0.5rem",
            background: "hsl(var(--v2-bg-muted))",
            border: "1px solid hsl(var(--v2-border))",
            borderRadius: 10,
            color: "hsl(var(--v2-fg-muted))",
            fontSize: "0.8125rem",
            fontWeight: 500,
            cursor: "pointer",
            transition: "all 0.15s",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
            {theme === "dark" ? <Moon size={13} /> : <Sun size={13} />}
            {theme === "dark" ? "Dark" : "Light"}
          </span>
          <span style={{
            background: "hsl(var(--v2-primary) / 0.15)",
            color: "hsl(var(--v2-primary))",
            borderRadius: 5,
            padding: "0.0625rem 0.375rem",
            fontSize: "0.6875rem",
            fontWeight: 600,
          }}>
            toggle
          </span>
        </button>

        <button
          onClick={signOut}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
            padding: "0.5rem 0.75rem",
            background: "transparent",
            border: "1px solid hsl(var(--v2-border))",
            borderRadius: 10,
            color: "hsl(var(--v2-fg-muted))",
            fontSize: "0.8125rem",
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.15s",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = "hsl(var(--v2-danger) / 0.12)";
            e.currentTarget.style.borderColor = "hsl(var(--v2-danger) / 0.4)";
            e.currentTarget.style.color = "hsl(var(--v2-danger))";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.borderColor = "hsl(var(--v2-border))";
            e.currentTarget.style.color = "hsl(var(--v2-fg-muted))";
          }}
        >
          <LogOut size={14} />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
