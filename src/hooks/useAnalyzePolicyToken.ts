import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface UseAnalyzePolicyTokenParams {
  generated: boolean;
  userId: string | null | undefined;
}

export function useAnalyzePolicyToken({
  generated,
  userId,
}: UseAnalyzePolicyTokenParams) {
  // Initialize with localStorage token for immediate availability
  // (especially for video-only flow before first analysis)
  const [ebayTokenForPolicies, setEbayTokenForPolicies] = useState<string | null>(
    () => localStorage.getItem("ebay-user-token")
  );

  // Stable function to load token from server or localStorage
  // Only depends on userId, not on listing data or publish payload
  const loadTokenIndependently = useCallback(async (): Promise<string | null> => {
    if (!userId) return localStorage.getItem("ebay-user-token");

    try {
      const { data } = await supabase.functions.invoke("ebay-publish", {
        body: { action: "get_stored_token", userId },
      });
      return data?.token ?? localStorage.getItem("ebay-user-token");
    } catch (e) {
      console.error("useAnalyzePolicyToken: Failed to load token from server", e);
      return localStorage.getItem("ebay-user-token");
    }
  }, [userId]); // Only depends on userId—stable across form changes

  useEffect(() => {
    if (!generated || !userId) return;
    let cancelled = false;

    (async () => {
      const token = await loadTokenIndependently();
      if (!cancelled) {
        setEbayTokenForPolicies(token);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [generated, userId, loadTokenIndependently]); // Stable dependencies

  return {
    ebayTokenForPolicies,
    setEbayTokenForPolicies,
  };
}
