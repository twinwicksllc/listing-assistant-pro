import { Camera, FileText, LayoutDashboard, CreditCard, Users } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

export default function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isOwner } = useAuth();

  const tabs = [
    { path: "/", icon: Camera, label: "Capture", show: true },
    { path: "/drafts", icon: FileText, label: "Drafts", show: true },
    { path: "/dashboard", icon: LayoutDashboard, label: "Dashboard", show: isOwner },
    { path: "/team", icon: Users, label: "Team", show: true },
    { path: "/billing", icon: CreditCard, label: "Billing", show: isOwner },
  ].filter((t) => t.show);

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-card border-t border-border z-50">
      <div className="flex max-w-lg mx-auto">
        {tabs.map((tab) => {
          const active = location.pathname === tab.path;
          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              className={`flex-1 flex flex-col items-center gap-1 py-3 transition-colors ${
                active ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <tab.icon className="w-5 h-5" />
              <span className="text-xs font-medium">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
