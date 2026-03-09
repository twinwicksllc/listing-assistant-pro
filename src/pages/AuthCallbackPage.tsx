import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, AlertTriangle } from "lucide-react";
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
 * the client initializes.
 */
export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const handled = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [retried, setRetried] = useState(false);

  useEffect(() => {
    const code = searchParams.get("code");
    const errorParam = searchParams.get("error");
    const errorDescription = searchParams.get("error_description");

    // Handle OAuth error from URL params
    if (errorParam) {
      setError(errorDescription || errorParam);
      return;
    }

    // Set a timeout fallback
    const timeout = setTimeout(() => {
      if (!handled.current) {
        console.warn("Auth callback timeout — redirecting to login");
        navigate("/login");
      }
    }, 10000);

    // Listen for auth state changes
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

    // Check for existing session
    supabase.auth.getSession().then(({ data: { session }, error: sessionError }) => {
      if (sessionError) {
        console.error("Session error:", sessionError);
        // PKCE exchange failed - the code verifier wasn't found
        if (code && !retried) {
          console.warn("PKCE exchange failed, code verifier may not be in storage");
          setError("Authentication failed. The login session may have expired. Please try again.");
          setRetried(true);
        }
        return;
      }
      
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
  }, [navigate, searchParams, retried]);

  if (error) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-5">
        <div className="flex flex-col items-center gap-4 max-w-md text-center">
          <img src={teckstartLogo} alt="Teckstart" className="h-12 w-auto" />
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-5 h-5" />
            <span className="font-medium">Authentication Error</span>
          </div>
          <p className="text-sm text-muted-foreground">{error}</p>
          <button
            onClick={() => navigate("/login")}
            className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90"
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

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