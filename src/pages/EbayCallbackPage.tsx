import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const EBAY_TOKEN_KEY = "ebay-user-token";

export default function EbayCallbackPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Connecting your eBay account…");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const error = params.get("error");
    const errorDesc = params.get("error_description");

    if (error) {
      setStatus("error");
      setMessage(errorDesc || error || "eBay authorization was denied.");
      return;
    }

    if (!code) {
      setStatus("error");
      setMessage("No authorization code received from eBay.");
      return;
    }

    // Exchange the code for a user token via our Edge Function
    console.log("EbayCallbackPage: exchanging code", code?.substring(0, 20) + "...");
    supabase.functions
      .invoke("ebay-publish", {
        body: { action: "exchange_code", code },
      })
      .then(({ data, error: fnError }) => {
        console.log("EbayCallbackPage: exchange response status", { 
          hasData: !!data, 
          hasError: !!fnError,
          dataStatus: data?.status 
        });
        
        if (fnError) {
          console.error("EbayCallbackPage: function error:", fnError);
          const msg = fnError.message || "Failed to connect eBay account";
          setStatus("error");
          setMessage(msg);
          return;
        }

        // Check if the response contains an error (either at top level or in data)
        if (data?.error) {
          console.error("EbayCallbackPage: API error:", data.error);
          
          // Provide specific guidance based on error type
          let userMessage = data.error;
          if (data.error.includes("not configured")) {
            userMessage = "eBay integration is not properly configured. Please contact support.";
          } else if (data.error.includes("expired")) {
            userMessage = "Your authorization code has expired. Please try connecting again.";
          } else if (data.error.includes("invalid")) {
            userMessage = "Invalid authorization code. Please try connecting again.";
          }
          
          setStatus("error");
          setMessage(userMessage);
          return;
        }

        const token = data?.access_token;
        if (!token) {
          console.error("EbayCallbackPage: no access_token in response:", data);
          setStatus("error");
          setMessage("eBay did not return an access token. Please try connecting again.");
          return;
        }

        // Store token in localStorage (same key used by DashboardPage & AnalyzePage)
        localStorage.setItem(EBAY_TOKEN_KEY, token);

        // Also store refresh token and expiry if provided
        if (data.refresh_token) {
          localStorage.setItem("ebay-refresh-token", data.refresh_token);
        }
        if (data.expires_in) {
          const expiresAt = Date.now() + data.expires_in * 1000;
          localStorage.setItem("ebay-token-expires-at", String(expiresAt));
        }

        console.log("EbayCallbackPage: success - token saved");
        setStatus("success");
        setMessage("eBay account connected successfully!");

        // Check if a specific post-auth redirect was requested (e.g. /drafts?publish=all)
        const postAuthRedirect = localStorage.getItem("ebay_post_auth_redirect") || "/dashboard";
        localStorage.removeItem("ebay_post_auth_redirect");

        // Redirect after a short delay
        setTimeout(() => navigate(postAuthRedirect, { replace: true }), 1800);
      })
      .catch((err: any) => {
        console.error("EbayCallbackPage: catch error:", err);
        setStatus("error");
        const msg = err?.message || "Failed to connect eBay account. Please try again.";
        setMessage(msg);
      });
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="bg-card border border-border rounded-2xl p-8 max-w-sm w-full text-center space-y-5 shadow-xl">
        {status === "loading" && (
          <>
            <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto" />
            <div>
              <h2 className="text-base font-semibold text-foreground">Connecting eBay</h2>
              <p className="text-sm text-muted-foreground mt-1">{message}</p>
            </div>
          </>
        )}

        {status === "success" && (
          <>
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
            <div>
              <h2 className="text-base font-semibold text-foreground">Connected!</h2>
              <p className="text-sm text-muted-foreground mt-1">{message}</p>
              <p className="text-xs text-muted-foreground mt-2">Redirecting to dashboard…</p>
            </div>
          </>
        )}

        {status === "error" && (
          <>
            <XCircle className="w-12 h-12 text-destructive mx-auto" />
            <div>
              <h2 className="text-base font-semibold text-foreground">Connection Failed</h2>
              <p className="text-sm text-muted-foreground mt-1">{message}</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => navigate("/dashboard", { replace: true })}
                className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-secondary transition-colors"
              >
                Go to Dashboard
              </button>
              <button
                onClick={() => window.history.back()}
                className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Try Again
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}