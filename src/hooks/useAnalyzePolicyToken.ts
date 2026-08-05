import { useEffect, useState } from "react";

interface UseAnalyzePolicyTokenParams {
  generated: boolean;
  userId: string | null | undefined;
  loadPolicyToken: () => Promise<string | null>;
}

export function useAnalyzePolicyToken({
  generated,
  userId,
  loadPolicyToken,
}: UseAnalyzePolicyTokenParams) {
  // Initialize with localStorage token for immediate availability
  // (especially for video-only flow before first analysis)
  const [ebayTokenForPolicies, setEbayTokenForPolicies] = useState<string | null>(
    () => localStorage.getItem("ebay-user-token")
  );

  useEffect(() => {
    if (!generated || !userId) return;
    let cancelled = false;

    (async () => {
      const token = await loadPolicyToken();
      if (!cancelled) {
        setEbayTokenForPolicies(token);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [generated, userId, loadPolicyToken]);

  return {
    ebayTokenForPolicies,
    setEbayTokenForPolicies,
  };
}
