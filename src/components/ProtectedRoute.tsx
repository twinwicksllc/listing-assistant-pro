import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, ShieldAlert } from "lucide-react";

interface ProtectedRouteProps {
  children: React.ReactNode;
  ownerOnly?: boolean;
}

export default function ProtectedRoute({
  children,
  ownerOnly,
}: ProtectedRouteProps) {
  const { user, loading, org, isOwner } = useAuth();
  const location = useLocation();

  if (loading || org.loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/landing" replace />;
  }

  // Owner-gated route reached by a non-owner.
  //
  // This previously redirected to "/", which bounced straight back to /home.
  // The result was a page that appeared to flicker and reload itself with no
  // explanation, which is indistinguishable from a broken link and made a real
  // permissions defect (see refreshOrg in AuthContext) effectively invisible.
  // Show the reason instead, and give the user a way forward.
  if (ownerOnly && !isOwner) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <div className="max-w-md w-full text-center">
          <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center">
            <ShieldAlert className="w-6 h-6 text-amber-600" />
          </div>
          <h1 className="text-lg font-semibold text-foreground mb-2">
            Owner access required
          </h1>
          <p className="text-sm text-muted-foreground mb-1">
            The page at <span className="font-mono">{location.pathname}</span> is
            only available to the owner of your organization.
          </p>
          <p className="text-sm text-muted-foreground mb-6">
            {org.role
              ? `You are signed in as a ${org.role}${
                  org.orgName ? ` of ${org.orgName}` : ""
                }.`
              : "We could not determine your role in an organization. If you believe this is wrong, sign out and back in, or contact support."}
          </p>
          <div className="flex items-center justify-center gap-3">
            <a
              href="/home"
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium"
            >
              Back to Capture
            </a>
            <a
              href="/settings"
              className="px-4 py-2 rounded-lg border border-border text-sm font-medium text-foreground"
            >
              Go to Settings
            </a>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
