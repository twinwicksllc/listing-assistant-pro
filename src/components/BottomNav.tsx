import { Camera, FileText, LayoutDashboard, CreditCard, Users, UserCircle } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useState } from "react";
import ProfileModal from "@/components/ProfileModal";

export default function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isOwner } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);

  const tabs = [
    { path: "/home", icon: Camera, label: "Capture", show: true, tourId: undefined },
    { path: "/drafts", icon: FileText, label: "Drafts", show: true, tourId: "analyze-tab" },
    { path: "/dashboard", icon: LayoutDashboard, label: "Dashboard", show: isOwner, tourId: undefined },
    { path: "/team", icon: Users, label: "Team", show: true, tourId: undefined },
    { path: "/billing", icon: CreditCard, label: "Billing", show: isOwner, tourId: undefined },
  ].filter((t) => t.show);

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 bg-card border-t border-border z-50">
        <div className="flex max-w-lg mx-auto">
          {tabs.map((tab) => {
            const active = location.pathname === tab.path;
            return (
              <button
                key={tab.path}
                onClick={() => navigate(tab.path)}
                data-tour={tab.tourId}
                className={`flex-1 flex flex-col items-center gap-1 py-3 transition-colors ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <tab.icon className="w-5 h-5" />
                <span className="text-xs font-medium">{tab.label}</span>
              </button>
            );
          })}

          {/* Profile button */}
          <button
            onClick={() => setProfileOpen(true)}
            className="flex-1 flex flex-col items-center gap-1 py-3 transition-colors text-muted-foreground hover:text-foreground"
          >
            <UserCircle className="w-5 h-5" />
            <span className="text-xs font-medium">Profile</span>
          </button>
        </div>
      </nav>

      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
    </>
  );
}