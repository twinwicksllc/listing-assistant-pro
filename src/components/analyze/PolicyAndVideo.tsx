import { ShieldCheck } from "lucide-react";
import { EbayPolicySelector } from "@/components/EbayPolicySelector";
import { VideoUploadInput } from "@/components/VideoUploadInput";
import type { SelectedPolicies } from "@/types/ebay-policies";

interface PolicyAndVideoProps {
  ebayTokenForPolicies: string | null;
  title: string;
  publishing: boolean;
  onPoliciesSelected: (policies: SelectedPolicies) => void;
  onVideoReady: (videoId: string, url: string) => void;
  onVideoRemoved: () => void;
  onVideoStatusChange: (status: string) => void;
}

export function PolicyAndVideo({
  ebayTokenForPolicies,
  title,
  publishing,
  onPoliciesSelected,
  onVideoReady,
  onVideoRemoved,
  onVideoStatusChange,
}: PolicyAndVideoProps) {
  return (
    <>
      {/* eBay Business Policies */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-primary" />
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            eBay Business Policies
          </label>
        </div>
        <EbayPolicySelector
          userToken={ebayTokenForPolicies}
          onPoliciesSelected={onPoliciesSelected}
          disabled={publishing}
        />
      </div>

      {/* Video Upload (optional) */}
      {ebayTokenForPolicies && (
        <VideoUploadInput
          title={title}
          userToken={ebayTokenForPolicies}
          onVideoReady={onVideoReady}
          onVideoRemoved={onVideoRemoved}
          onStatusChange={onVideoStatusChange}
        />
      )}
    </>
  );
}
