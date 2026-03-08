import { useEffect } from "react";
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
 * Supabase automatically parses the #access_token / ?code fragment from
 * the URL and establishes the session via onAuthStateChange. We just need
 * to wait for that event and then push the user to the home page.
 */
export default function AuthCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    // exchangeCodeForSession handles the PKCE code flow (OAuth)
    const { searchParams } = new URL(window.location.href);
    const code = searchParams.get("code");

    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) {
          console.error("Auth callback error:", error.message);
          navigate("/login?error=auth_callback_failed");
        } else {
          navigate("/");
        }
      });
      return;
    }

    // Fallback: listen for the session to be set from the URL hash (implicit flow)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        navigate("/");
      } else if (event === "PASSWORD_RECOVERY") {
        navigate("/reset-password");
      }
    });

    return () => subscription.unsubscribe();
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