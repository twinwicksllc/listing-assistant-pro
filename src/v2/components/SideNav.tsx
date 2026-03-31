/**
 * SideNav — V2 Sidebar Navigation
 * 
 * Features:
 *   - Consistent Honolulu Blue (#0076B6) background
 *   - Section-based collapsible navigation with v2-styled buttons
 *   - Support for owner-only sections (Money section)
 *   - Active state highlighting
 *   - All routes now point to v2 pages (no more "2" suffix paths)
 */

import { useState } from "react";
import {
  Camera, FileText, LayoutDashboard, Layers,
  TrendingUp, Zap, Receipt, DollarSign,
  ShoppingCart, Users, Settings,
  ChevronDown, ChevronUp, LogOut, Heart, LayoutList,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import teckstartLogo from "@/assets/teckstart-logo.png";
import { useAuth } from "@/contexts/AuthContext";

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

const SIDEBAR_BG = "#0076B6"; // Honolulu Blue
const ACTIVE_BG = "rgba(255,255,255,0.15)";
const HOVER_BG = "rgba(255,255,255,0.08)";

export default function SideNav() {
  const location  = useLocation();
  const navigate  = useNavigate();
  const { isOwner, signOut, user, currentPlan } = useAuth();
  const sections  = useNavSections(isOwner);

  // All sections start expanded (per spec)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const isActive = (item: NavItem) => {
    const p = location.pathname;
    return p === item.path;
  };

  const handleNav = (item: NavItem) => {
    navigate(item.path);
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
        background: SIDEBAR_BG,
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
        borderBottom: "1px solid rgba(255,255,255,0.12)",
      }}>
        <img
          src={teckstartLogo}
          alt="Teckstart"
          style={{ height: 32, width: "auto", maxWidth: 120, flexShrink: 0, objectFit: "contain" }}
        />
      </div>

      {/* ─── Navigation Sections ─────────────────────────────────────────── */}
      <div style={{ flex: 1, padding: "0.5rem 0" }}>
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
                  padding: "0.5rem 0.875rem",
                  background: "transparent",
                  border: "none",
                  color: "rgba(255,255,255,0.7)",
                  fontSize: "0.6875rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  cursor: "pointer",
                  transition: "color 0.15s",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.color = "rgba(255,255,255,0.9)";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.color = "rgba(255,255,255,0.7)";
                }}
              >
                {section.label}
                {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              </button>

              {/* Section items */}
              {!isCollapsed && (
                <div>
                  {section.items.map(item => {
                    const active = isActive(item);
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.path}
                        onClick={() => handleNav(item)}
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          gap: "0.625rem",
                          padding: "0.625rem 0.875rem",
                          marginLeft: "0.375rem",
                          background: active ? ACTIVE_BG : "transparent",
                          border: "none",
                          color: "#ffffff",
                          fontSize: "0.875rem",
                          fontWeight: active ? 600 : 400,
                          cursor: "pointer",
                          transition: "background 0.15s",
                          borderRadius: active ? 8 : 0,
                        }}
                        onMouseEnter={e => {
                          if (!active) {
                            e.currentTarget.style.background = HOVER_BG;
                          }
                        }}
                        onMouseLeave={e => {
                          if (!active) {
                            e.currentTarget.style.background = "transparent";
                          }
                        }}
                      >
                        <Icon size={16} style={{ flexShrink: 0 }} />
                        <span>{item.label}</span>
                        {active && (
                          <span
                            style={{
                              width: 3,
                              height: 3,
                              borderRadius: "50%",
                              background: "#ffffff",
                              marginLeft: "auto",
                              boxShadow: "0 0 4px rgba(255,255,255,0.5)",
                            }}
                          />
                        )}
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
        borderTop: "1px solid rgba(255,255,255,0.12)",
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "0.625rem",
          marginBottom: "0.625rem",
        }}>
          <div style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#ffffff",
            fontSize: "0.8125rem",
            fontWeight: 600,
          }}>
            {user?.email?.[0]?.toUpperCase() || "U"}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              color: "#ffffff",
              fontSize: "0.8125rem",
              fontWeight: 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}>
              {user?.email || "User"}
            </div>
            <div style={{
              color: "rgba(255,255,255,0.6)",
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

        <button
          onClick={signOut}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
            padding: "0.5rem 0.75rem",
            background: "rgba(255,255,255,0.1)",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: 8,
            color: "#ffffff",
            fontSize: "0.8125rem",
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.15s",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = "rgba(255,255,255,0.15)";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.3)";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "rgba(255,255,255,0.1)";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)";
          }}
        >
          <LogOut size={14} />
          Sign Out
        </button>
      </div>
    </aside>
  );
}