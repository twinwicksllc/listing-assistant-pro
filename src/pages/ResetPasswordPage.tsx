import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import teckstartLogo from "@/assets/teckstart-logo.png";
import { Loader2, Lock } from "lucide-react";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [isRecovery, setIsRecovery] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const handled = useRef(false);

  useEffect(() => {
    // With flowType: 'pkce', the Supabase client automatically exchanges the
    // ?code= param when it initializes. Do NOT call exchangeCodeForSession()
    // manually — it will fail with "PKCE code verifier not found".
    //
    // Instead, listen for the PASSWORD_RECOVERY event which fires automatically
    // after the client completes the PKCE exchange.

    const timeout = setTimeout(() => {
      if (!handled.current) {
        setWaiting(false); // Show "invalid link" UI after 10s with no event
      }
    }, 10000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (handled.current) return;
      if (event === "PASSWORD_RECOVERY") {
        handled.current = true;
        clearTimeout(timeout);
        setWaiting(false);
        setIsRecovery(true);
      } else if (event === "SIGNED_IN") {
        // PKCE flow fires SIGNED_IN before PASSWORD_RECOVERY — wait a tick
        // to see if PASSWORD_RECOVERY follows
        setTimeout(() => {
          if (!handled.current) {
            handled.current = true;
            clearTimeout(timeout);
            setWaiting(false);
            setIsRecovery(true);
          }
        }, 500);
      }
    });

    // Also check if we already have a recovery session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && !handled.current) {
        // If we have a session on this page, treat it as recovery
        handled.current = true;
        clearTimeout(timeout);
        setWaiting(false);
        setIsRecovery(true);
      }
    });

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [navigate]);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Password updated successfully!");
      navigate("/home");
    }
  };

  // Show spinner while waiting for PKCE exchange to complete
  if (waiting) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-5">
        <div className="flex flex-col items-center gap-4">
          <img src={teckstartLogo} alt="Teckstart" className="h-12 w-auto" />
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Verifying reset link...</p>
        </div>
      </div>
    );
  }

  if (!isRecovery) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-5">
        <div className="w-full max-w-sm text-center space-y-4">
          <img src={teckstartLogo} alt="Teckstart" className="h-12 w-auto mx-auto" />
          <p className="text-sm text-muted-foreground">Invalid or expired reset link.</p>
          <button onClick={() => navigate("/forgot-password")} className="text-sm text-primary font-medium hover:underline">
            Request a new reset link
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-5">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-2">
          <img src={teckstartLogo} alt="Teckstart" className="h-12 w-auto" />
          <h1 className="text-xl font-bold text-foreground">Set new password</h1>
          <p className="text-sm text-muted-foreground">Choose a strong password for your account</p>
        </div>

        <form onSubmit={handleUpdate} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">New Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Min 6 characters"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm transition-all hover:opacity-90 disabled:opacity-60"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Update Password
          </button>
        </form>
      </div>
    </div>
  );
}