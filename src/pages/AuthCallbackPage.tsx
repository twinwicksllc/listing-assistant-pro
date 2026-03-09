import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import teckstartLogo from "@/assets/teckstart-logo.png";

/**
 * AuthCallbackPage
 *
 * Handles the redirect back from:
 *  - Google OAuth (signInWithOAuth redirectTo)
 *  - Email confirmation links (signUp emailRedirectTo)
 *
 * With flowType: 'pkce', the Supabase client automatically detects the
 * ?code= param in the URL and exchanges it for a session internally when
 * the client initializes. We must NOT call exchangeCodeForSession() manually
 * as that consumes the code and causes a "PKCE code verifier not found" error.
 *
 * Instead, we simply listen for onAuthStateChange and redirect accordingly.
 */
export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const handled = useRef(false);

  useEffect(() => {
    // Set a timeout fallback in case the auth state change never fires
    const timeout = setTimeout(() => {
      if (!handled.current) {
        console.warn("Auth callback timeout — redirecting to login");
        navigate("/login");
      }
    }, 10000);

    // With flowType: 'pkce', Supabase client auto-exchanges the ?code= param.
    // Just listen for the resulting auth state change.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (handled.current) return;

      if (event === "SIGNED_IN" && session) {
        handled.current = true;
        clearTimeout(timeout);
        navigate("/home");
      } else if (event === "PASSWORD_RECOVERY") {
        handled.current = true;
        clearTimeout(timeout);
        navigate("/reset-password");
      }
    });

    // Also check if a session already exists (in case the event fired before
    // the listener was registered)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && !handled.current) {
        handled.current = true;
        clearTimeout(timeout);
        navigate("/home");
      }
    });

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-5">
      <div className="flex flex-col items-center gap-4">
        <img src={teckstartLogo} alt="Teckstart" className="h-12 w-auto" />
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Signing you in...</p>
      </div>
    </div>
  );
}