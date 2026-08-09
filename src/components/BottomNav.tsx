import { useState, useEffect, useRef } from "react";
import {
  Camera,
  FileText,
  LayoutDashboard,
  Settings,
  Layers,
  TrendingUp,
  Zap,
  Receipt,
  DollarSign,
  ShoppingCart,
  Users,
  MoreHorizontal,
  X,
  ChevronRight,
  LogOut,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

// ── Types ──────────────────────────────────────────────────────────────────

interface NavItem {
  path: string;
  icon: React.ElementType;
  label: string;
  tourId?: string;
}

interface NavGroup {
  key: string;
  icon: React.ElementType;
  label: string;
  color: string; // Tailwind text color for icon tint
  bgColor: string; // background chip color
  items: NavItem[];
}

// ── Nav structure ──────────────────────────────────────────────────────────

export default function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isOwner, signOut } = useAuth();

  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Close sheet when route changes
  useEffect(() => {
    setOpenGroup(null);
  }, [location.pathname]);

  // Close sheet when tapping backdrop
  useEffect(() => {
    if (!openGroup) return;
    const handler = (e: MouseEvent) => {
      if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) {
        setOpenGroup(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openGroup]);

  // ── Permanent tabs (always shown in bar) ──────────────────────────────
  const permanentTabs: NavItem[] = [
    { path: "/home", icon: Camera, label: "Capture", tourId: undefined },
    { path: "/drafts", icon: FileText, label: "Drafts", tourId: "analyze-tab" },
    { path: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
    { path: "/settings", icon: Settings, label: "Settings" },
  ];

  // ── Expandable groups ──────────────────────────────────────────────────
  const groups: NavGroup[] = [
    {
      key: "manage",
      icon: Layers,
      label: "Manage",
      color: "text-blue-500",
      bgColor: "bg-blue-50 dark:bg-blue-950/40",
      items: [
        { path: "/bulk", icon: Layers, label: "Bulk List" },
        { path: "/market", icon: TrendingUp, label: "Market Research" },
        ...(isOwner
          ? [{ path: "/reprice-rules", icon: Zap, label: "Optimize" }]
          : []),
      ],
    },
    {
      key: "money",
      icon: Receipt,
      label: "Money",
      color: "text-emerald-500",
      bgColor: "bg-emerald-50 dark:bg-emerald-950/40",
      items: isOwner
        ? [
            { path: "/profit-report", icon: Receipt, label: "P&L Report" },
            { path: "/cogs-editor", icon: DollarSign, label: "COGS Editor" },
            {
              path: "/historical-cogs",
              icon: ShoppingCart,
              label: "Backfill COGS",
            },
          ]
        : [],
    },
    {
      key: "account",
      icon: Users,
      label: "Account",
      color: "text-violet-500",
      bgColor: "bg-violet-50 dark:bg-violet-950/40",
      items: [{ path: "/team", icon: Users, label: "Team" }],
    },
  ].filter((g) => g.items.length > 0);

  // ── Helpers ────────────────────────────────────────────────────────────

  const isGroupActive = (group: NavGroup) =>
    group.items.some((item) => location.pathname === item.path);

  const currentGroup = openGroup
    ? groups.find((g) => g.key === openGroup)
    : null;

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <>
      {/* Backdrop */}
      {openGroup && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]"
          onClick={() => setOpenGroup(null)}
        />
      )}

      {/* Slide-up sheet */}
      {currentGroup && (
        <div
          ref={sheetRef}
          className="fixed bottom-[64px] left-0 right-0 z-50 mx-auto max-w-lg px-3 pb-1"
          style={{ animation: "slideUp 0.18s ease-out" }}
        >
          <div
            className={`rounded-2xl border border-border bg-card shadow-xl overflow-hidden`}
          >
            {/* Sheet header */}
            <div
              className={`flex items-center justify-between px-4 py-3 ${currentGroup.bgColor} border-b border-border/50`}
            >
              <div className="flex items-center gap-2">
                <currentGroup.icon
                  className={`w-4 h-4 ${currentGroup.color}`}
                />
                <span className={`text-sm font-semibold ${currentGroup.color}`}>
                  {currentGroup.label}
                </span>
              </div>
              <button
                onClick={() => setOpenGroup(null)}
                className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Sheet items */}
            <div className="divide-y divide-border/40">
              {currentGroup.items.map((item) => {
                const active = location.pathname === item.path;
                return (
                  <button
                    key={item.path}
                    onClick={() => {
                      navigate(item.path);
                      setOpenGroup(null);
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 transition-colors text-left ${
                      active
                        ? `${currentGroup.bgColor} ${currentGroup.color}`
                        : "hover:bg-muted/50 text-foreground"
                    }`}
                  >
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        active ? `${currentGroup.bgColor}` : "bg-muted/60"
                      }`}
                    >
                      <item.icon
                        className={`w-4 h-4 ${active ? currentGroup.color : "text-muted-foreground"}`}
                      />
                    </div>
                    <span className="text-sm font-medium flex-1">
                      {item.label}
                    </span>
                    {active && (
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${currentGroup.bgColor} ${currentGroup.color}`}
                      >
                        Active
                      </span>
                    )}
                    {!active && (
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Bottom bar */}
      <nav
        className="fixed bottom-0 left-0 right-0 bg-card/95 backdrop-blur border-t border-border z-50"
        style={{ height: 64 }}
      >
        <div className="flex max-w-lg mx-auto h-full">
          {/* Permanent tabs */}
          {permanentTabs.map((tab) => {
            const active = location.pathname === tab.path;
            return (
              <button
                key={tab.path}
                onClick={() => {
                  navigate(tab.path);
                  setOpenGroup(null);
                }}
                data-tour={tab.tourId}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <tab.icon className="w-5 h-5" />
                <span className="text-[10px] font-medium">{tab.label}</span>
              </button>
            );
          })}

          {/* Vertical divider */}
          <div className="w-px bg-border/60 my-3" />

          {/* Group buttons */}
          {groups.map((group) => {
            const active = isGroupActive(group);
            const isOpen = openGroup === group.key;
            return (
              <button
                key={group.key}
                onClick={() => setOpenGroup(isOpen ? null : group.key)}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors relative ${
                  active || isOpen
                    ? group.color
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {/* Active dot indicator */}
                {active && !isOpen && (
                  <span
                    className={`absolute top-2 right-1/4 w-1.5 h-1.5 rounded-full ${group.color.replace(
                      "text-",
                      "bg-",
                    )}`}
                  />
                )}
                {/* Open chevron indicator */}
                {isOpen ? (
                  <X className="w-5 h-5" />
                ) : (
                  <group.icon className="w-5 h-5" />
                )}
                <span className="text-[10px] font-medium">{group.label}</span>
              </button>
            );
          })}

          {/* Logout button */}
          <button
            onClick={signOut}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors text-muted-foreground hover:text-red-500"
            title="Sign out"
          >
            <LogOut className="w-5 h-5" />
            <span className="text-[10px] font-medium">Logout</span>
          </button>
        </div>
      </nav>

      {/* Slide-up keyframe */}
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  );
}
